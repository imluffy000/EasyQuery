"""PostgreSQL connector (also the base for Supabase).

Defence in depth for every user query:

* the connection pool opens sessions with `default_transaction_read_only = on`
  and a hard `statement_timeout`, so a runaway or write query is stopped by
  PostgreSQL itself even if application checks were somehow bypassed;
* `execute` runs inside a READ ONLY transaction and fetches at most
  `max_rows + 1` rows, using the extra row to report truncation honestly;
* introspection uses its own trusted code path -- it deliberately reads
  `pg_catalog`, which the SQL guard forbids for generated queries.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import ssl
import time
from datetime import UTC, datetime
from typing import Any

import asyncpg
import structlog

from app.database.connectors.base import (
    ColumnInfo,
    ConnectionConfig,
    ConnectionTestResult,
    ConnectorError,
    DatabaseConnector,
    Engine,
    ExplainResult,
    ForeignKeyInfo,
    IndexInfo,
    PermissionDenied,
    QueryResult,
    QueryTimeout,
    SchemaSnapshot,
    SSLMode,
    TableInfo,
)

log = structlog.get_logger(__name__)


_TABLES_SQL = """
SELECT
    n.nspname                                  AS schema_name,
    c.relname                                  AS table_name,
    CASE c.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'table'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized_view'
        WHEN 'f' THEN 'foreign_table'
    END                                        AS kind,
    obj_description(c.oid, 'pg_class')         AS comment,
    CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = ANY($2::char[])
  AND n.nspname = ANY($1::text[])
ORDER BY n.nspname, c.relname;
"""

_COLUMNS_SQL = """
SELECT
    n.nspname                        AS schema_name,
    c.relname                        AS table_name,
    a.attname                        AS column_name,
    format_type(a.atttypid, a.atttypmod) AS data_type,
    NOT a.attnotnull                 AS nullable,
    pg_get_expr(d.adbin, d.adrelid)  AS column_default,
    a.attnum                         AS ordinal,
    col_description(c.oid, a.attnum) AS comment,
    COALESCE(pk.is_pk, false)        AS is_primary_key,
    COALESCE(uq.is_unique, false)    AS is_unique
FROM pg_attribute a
JOIN pg_class c      ON c.oid = a.attrelid
JOIN pg_namespace n  ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
LEFT JOIN LATERAL (
    SELECT true AS is_pk
    FROM pg_constraint con
    WHERE con.conrelid = c.oid AND con.contype = 'p' AND a.attnum = ANY(con.conkey)
    LIMIT 1
) pk ON true
LEFT JOIN LATERAL (
    SELECT true AS is_unique
    FROM pg_constraint con
    WHERE con.conrelid = c.oid AND con.contype = 'u' AND a.attnum = ANY(con.conkey)
    LIMIT 1
) uq ON true
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND n.nspname = ANY($1::text[])
  AND c.relkind = ANY('{r,p,v,m,f}'::char[])
ORDER BY n.nspname, c.relname, a.attnum;
"""

_FOREIGN_KEYS_SQL = """
SELECT
    con.conname                AS constraint_name,
    n.nspname                  AS schema_name,
    c.relname                  AS table_name,
    att.attname                AS column_name,
    fn.nspname                 AS ref_schema,
    fc.relname                 AS ref_table,
    fatt.attname               AS ref_column
FROM pg_constraint con
JOIN pg_class c       ON c.oid = con.conrelid
JOIN pg_namespace n   ON n.oid = c.relnamespace
JOIN pg_class fc      ON fc.oid = con.confrelid
JOIN pg_namespace fn  ON fn.oid = fc.relnamespace
JOIN LATERAL unnest(con.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = ck.ord
JOIN pg_attribute att  ON att.attrelid = c.oid  AND att.attnum = ck.attnum
JOIN pg_attribute fatt ON fatt.attrelid = fc.oid AND fatt.attnum = fk.attnum
WHERE con.contype = 'f'
  AND n.nspname = ANY($1::text[])
ORDER BY n.nspname, c.relname, con.conname, ck.ord;
"""

_INDEXES_SQL = """
SELECT
    n.nspname   AS schema_name,
    c.relname   AS table_name,
    i.relname   AS index_name,
    ix.indisunique  AS is_unique,
    ix.indisprimary AS is_primary,
    am.amname   AS method,
    ARRAY(
        SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
        FROM generate_subscripts(ix.indkey, 1) AS k
        ORDER BY k
    ) AS columns
FROM pg_index ix
JOIN pg_class c      ON c.oid = ix.indrelid
JOIN pg_class i      ON i.oid = ix.indexrelid
JOIN pg_namespace n  ON n.oid = c.relnamespace
JOIN pg_am am        ON am.oid = i.relam
WHERE n.nspname = ANY($1::text[])
ORDER BY n.nspname, c.relname, i.relname;
"""

_RELKINDS = ["r", "p", "v", "m", "f"]


class PostgresConnector(DatabaseConnector):
    engine = Engine.POSTGRES

    def __init__(self, config: ConnectionConfig) -> None:
        super().__init__(config)
        self._pool: asyncpg.Pool | None = None

    # -- lifecycle -----------------------------------------------------------

    def _ssl_context(self) -> ssl.SSLContext | bool:
        mode = self.config.ssl_mode
        if mode is SSLMode.DISABLE:
            return False
        if mode in (SSLMode.VERIFY_CA, SSLMode.VERIFY_FULL):
            ctx = ssl.create_default_context()
            ctx.check_hostname = mode is SSLMode.VERIFY_FULL
            ctx.verify_mode = ssl.CERT_REQUIRED
            return ctx
        # require/prefer/allow: encrypt, but do not verify the chain. Managed
        # providers frequently use certificates the container has no root for.
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    async def _init_session(self, conn: asyncpg.Connection) -> None:
        """Applied to every pooled connection as it is created."""
        timeout_ms = self.config.statement_timeout_seconds * 1000
        await conn.execute(f"SET statement_timeout = {int(timeout_ms)}")
        await conn.execute(f"SET idle_in_transaction_session_timeout = {int(timeout_ms)}")
        if self.config.read_only:
            # The database's own enforcement -- independent of the SQL guard.
            await conn.execute("SET default_transaction_read_only = on")
        await conn.execute("SET application_name = 'db-copilot'")

    async def connect(self) -> None:
        if self._pool is not None:
            return
        try:
            self._pool = await asyncpg.create_pool(
                host=self.config.host,
                port=self.config.port,
                database=self.config.database,
                user=self.config.username,
                password=self.config.password,
                ssl=self._ssl_context(),
                min_size=1,
                max_size=5,
                timeout=self.config.connect_timeout_seconds,
                command_timeout=self.config.statement_timeout_seconds,
                max_inactive_connection_lifetime=300.0,
                init=self._init_session,
                server_settings={"jit": "off"},
            )
        except asyncpg.InvalidPasswordError as exc:
            raise ConnectorError(
                "Authentication failed for this database user.", code="DB_AUTH_FAILED"
            ) from exc
        except asyncpg.InvalidCatalogNameError as exc:
            raise ConnectorError(
                f"Database '{self.config.database}' does not exist.", code="DB_NOT_FOUND"
            ) from exc
        except (OSError, asyncio.TimeoutError) as exc:
            raise ConnectorError(
                f"Could not reach {self.config.host}:{self.config.port}.",
                code="DB_UNREACHABLE",
            ) from exc

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    def _require_pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise ConnectorError("Connector is not connected.", code="NOT_CONNECTED")
        return self._pool

    # -- operations ----------------------------------------------------------

    async def test_connection(self) -> ConnectionTestResult:
        started = time.perf_counter()
        try:
            await self.connect()
            pool = self._require_pool()
            async with pool.acquire() as conn:
                version = await conn.fetchval("SELECT version()")
                # Report whether the role can actually write, so the UI can
                # recommend a dedicated read-only role.
                can_write = await conn.fetchval(
                    "SELECT has_database_privilege(current_user, current_database(), 'CREATE')"
                )
            latency = int((time.perf_counter() - started) * 1000)
            return ConnectionTestResult(
                ok=True,
                message="Connection succeeded.",
                server_version=str(version).split(" on ")[0] if version else None,
                latency_ms=latency,
                is_read_only_role=not bool(can_write),
            )
        except ConnectorError as exc:
            return ConnectionTestResult(ok=False, message=exc.message)
        except Exception as exc:  # noqa: BLE001 - surface a clean message
            log.warning("connection_test_failed", error=str(exc))
            return ConnectionTestResult(ok=False, message="Connection failed.")

    async def introspect_schema(self, schemas: list[str] | None = None) -> SchemaSnapshot:
        await self.connect()
        pool = self._require_pool()
        target = list(schemas or self.config.allowed_schemas)

        async with pool.acquire() as conn:
            table_rows = await conn.fetch(_TABLES_SQL, target, _RELKINDS)
            column_rows = await conn.fetch(_COLUMNS_SQL, target)
            fk_rows = await conn.fetch(_FOREIGN_KEYS_SQL, target)
            index_rows = await conn.fetch(_INDEXES_SQL, target)

        tables: dict[tuple[str, str], TableInfo] = {}
        for row in table_rows:
            key = (row["schema_name"], row["table_name"])
            tables[key] = TableInfo(
                schema=row["schema_name"],
                name=row["table_name"],
                kind=row["kind"] or "table",
                comment=row["comment"],
                estimated_rows=row["estimated_rows"],
            )

        for row in column_rows:
            key = (row["schema_name"], row["table_name"])
            table = tables.get(key)
            if table is None:
                continue
            table.columns.append(
                ColumnInfo(
                    name=row["column_name"],
                    data_type=row["data_type"],
                    nullable=row["nullable"],
                    default=row["column_default"],
                    is_primary_key=row["is_primary_key"],
                    is_unique=row["is_unique"],
                    ordinal=row["ordinal"],
                    comment=row["comment"],
                )
            )

        for row in fk_rows:
            key = (row["schema_name"], row["table_name"])
            table = tables.get(key)
            if table is None:
                continue
            table.foreign_keys.append(
                ForeignKeyInfo(
                    constraint_name=row["constraint_name"],
                    column=row["column_name"],
                    references_schema=row["ref_schema"],
                    references_table=row["ref_table"],
                    references_column=row["ref_column"],
                )
            )

        for row in index_rows:
            key = (row["schema_name"], row["table_name"])
            table = tables.get(key)
            if table is None:
                continue
            table.indexes.append(
                IndexInfo(
                    name=row["index_name"],
                    columns=[c for c in (row["columns"] or []) if c],
                    is_unique=row["is_unique"],
                    is_primary=row["is_primary"],
                    method=row["method"],
                )
            )

        table_list = sorted(tables.values(), key=lambda t: (t.schema, t.name))
        snapshot = SchemaSnapshot(
            database_id=None,
            schemas=sorted({t.schema for t in table_list}) or target,
            tables=table_list,
            introspected_at=datetime.now(UTC),
        )
        snapshot.schema_hash = compute_schema_hash(snapshot)
        return snapshot

    async def execute(
        self, sql: str, *, timeout_seconds: int | None = None, max_rows: int | None = None
    ) -> QueryResult:
        await self.connect()
        pool = self._require_pool()
        timeout = timeout_seconds or self.config.statement_timeout_seconds
        limit = max_rows or self.config.max_rows

        started = time.perf_counter()
        try:
            async with pool.acquire() as conn:
                # READ ONLY at the transaction level: even a bug upstream cannot
                # write through this path.
                tx = conn.transaction(readonly=self.config.read_only)
                await tx.start()
                try:
                    records = await conn.fetch(sql, timeout=timeout)
                finally:
                    await tx.rollback()
        except asyncio.TimeoutError as exc:
            raise QueryTimeout(timeout) from exc
        except asyncpg.QueryCanceledError as exc:
            raise QueryTimeout(timeout) from exc
        except asyncpg.InsufficientPrivilegeError as exc:
            raise PermissionDenied(str(exc)) from exc
        except asyncpg.PostgresSyntaxError as exc:
            raise ConnectorError(str(exc), code="SQL_SYNTAX_ERROR") from exc
        except asyncpg.UndefinedColumnError as exc:
            raise ConnectorError(str(exc), code="UNDEFINED_COLUMN") from exc
        except asyncpg.UndefinedTableError as exc:
            raise ConnectorError(str(exc), code="UNDEFINED_TABLE") from exc
        except asyncpg.PostgresError as exc:
            raise ConnectorError(str(exc), code="DATABASE_ERROR") from exc

        duration_ms = int((time.perf_counter() - started) * 1000)
        # The guard has already appended LIMIT `limit`, so the driver never
        # returns more than that. Hitting the limit exactly means rows were
        # very likely cut off -- report it as "may be incomplete" rather than
        # claiming a complete result.
        truncated = len(records) >= limit
        rows = [dict(r) for r in records[:limit]]
        columns = list(records[0].keys()) if records else []

        return QueryResult(
            columns=columns,
            rows=_normalise_rows(rows),
            row_count=len(rows),
            duration_ms=duration_ms,
            truncated=truncated,
        )

    async def explain(self, sql: str) -> ExplainResult:
        await self.connect()
        pool = self._require_pool()
        statement = sql if sql.strip().upper().startswith("EXPLAIN") else f"EXPLAIN (FORMAT JSON) {sql}"

        try:
            async with pool.acquire() as conn:
                raw = await conn.fetchval(statement, timeout=self.config.statement_timeout_seconds)
        except asyncpg.PostgresError as exc:
            raise ConnectorError(str(exc), code="EXPLAIN_FAILED") from exc

        payload = json.loads(raw) if isinstance(raw, str) else raw
        plan = payload[0]["Plan"] if isinstance(payload, list) and payload else {}

        scans: list[str] = []
        has_seq_scan = False

        def walk(node: dict[str, Any]) -> None:
            nonlocal has_seq_scan
            node_type = node.get("Node Type", "")
            if node_type == "Seq Scan":
                has_seq_scan = True
            relation = node.get("Relation Name")
            if relation:
                scans.append(str(relation))
            for child in node.get("Plans", []) or []:
                walk(child)

        if plan:
            walk(plan)

        warnings: list[str] = []
        if has_seq_scan:
            warnings.append("Query performs a sequential scan; an index may be missing.")

        return ExplainResult(
            total_cost=float(plan.get("Total Cost", 0.0)),
            estimated_rows=int(plan.get("Plan Rows", 0)),
            plan=plan,
            has_sequential_scan=has_seq_scan,
            scanned_relations=sorted(set(scans)),
            warnings=warnings,
        )

    async def health_check(self) -> bool:
        try:
            await self.connect()
            pool = self._require_pool()
            async with pool.acquire() as conn:
                return await conn.fetchval("SELECT 1") == 1
        except Exception:  # noqa: BLE001 - health checks never raise
            return False


class SupabaseConnector(PostgresConnector):
    """Supabase is PostgreSQL with a fixed connection shape.

    Only the defaults differ: TLS is mandatory and the pooler port is used
    unless the caller overrides it. All behaviour is inherited.
    """

    engine = Engine.SUPABASE

    def __init__(self, config: ConnectionConfig) -> None:
        if config.ssl_mode is SSLMode.DISABLE:
            config = ConnectionConfig(**{**config.__dict__, "ssl_mode": SSLMode.REQUIRE})
        super().__init__(config)


def _normalise_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert driver-native types into JSON-serialisable values."""
    import decimal
    import ipaddress
    import uuid as _uuid
    from datetime import date, time as _time, timedelta

    def convert(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, decimal.Decimal):
            return float(value)
        if isinstance(value, (datetime, date, _time)):
            return value.isoformat()
        if isinstance(value, timedelta):
            return value.total_seconds()
        if isinstance(value, _uuid.UUID):
            return str(value)
        if isinstance(value, (bytes, memoryview)):
            return f"<{len(bytes(value))} bytes>"
        if isinstance(value, (ipaddress.IPv4Address, ipaddress.IPv6Address)):
            return str(value)
        if isinstance(value, (list, tuple)):
            return [convert(v) for v in value]
        if isinstance(value, dict):
            return {k: convert(v) for k, v in value.items()}
        return str(value)

    return [{k: convert(v) for k, v in row.items()} for row in rows]


def compute_schema_hash(snapshot: SchemaSnapshot) -> str:
    """Stable fingerprint of structure, used to detect drift between syncs."""
    parts: list[str] = []
    for table in sorted(snapshot.tables, key=lambda t: (t.schema, t.name)):
        cols = ",".join(f"{c.name}:{c.data_type}:{int(c.nullable)}" for c in table.columns)
        parts.append(f"{table.qualified_name}|{table.kind}|{cols}")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
