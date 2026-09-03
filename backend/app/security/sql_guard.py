"""Parser-based SQL validation.

This is the application-level half of a two-layer defence. The other half is a
read-only database role (see infra/postgres/init.sql). Neither layer is trusted
alone, and neither is the LLM: the model never decides what is safe to run,
this module does.

Validation works on a parsed AST (sqlglot), never on string matching --
regex-based SQL filtering is trivially bypassed with comments, casing,
string-splitting and unicode tricks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError


class GuardViolation(StrEnum):
    PARSE_ERROR = "PARSE_ERROR"
    MULTIPLE_STATEMENTS = "MULTIPLE_STATEMENTS"
    STATEMENT_NOT_ALLOWED = "STATEMENT_NOT_ALLOWED"
    DDL_BLOCKED = "DDL_BLOCKED"
    DML_BLOCKED = "DML_BLOCKED"
    SCHEMA_NOT_ALLOWED = "SCHEMA_NOT_ALLOWED"
    FUNCTION_BLOCKED = "FUNCTION_BLOCKED"
    TOO_MANY_JOINS = "TOO_MANY_JOINS"
    SYSTEM_CATALOG = "SYSTEM_CATALOG"
    EMPTY_STATEMENT = "EMPTY_STATEMENT"


@dataclass(frozen=True)
class GuardError:
    code: GuardViolation
    message: str


@dataclass
class GuardResult:
    """Outcome of validating one statement."""

    ok: bool
    errors: list[GuardError] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # Rewritten SQL: the only string that may ever reach the database.
    safe_sql: str | None = None
    tables: list[str] = field(default_factory=list)
    schemas: list[str] = field(default_factory=list)
    join_count: int = 0
    had_limit: bool = False
    limit_applied: int | None = None

    @property
    def error_codes(self) -> list[str]:
        return [e.code.value for e in self.errors]

    @property
    def first_message(self) -> str:
        return self.errors[0].message if self.errors else ""


# Statement node types permitted in read-only mode. Anything not listed is
# refused by default -- an allowlist, so a new sqlglot expression type cannot
# silently become executable.
_READONLY_STATEMENTS: tuple[type[exp.Expression], ...] = (
    exp.Select,
    exp.Union,
    exp.Except,
    exp.Intersect,
    exp.Subquery,
    exp.With,
)

_DML_NODES: tuple[type[exp.Expression], ...] = (
    exp.Insert,
    exp.Update,
    exp.Delete,
    exp.Merge,
)

_DDL_NODES: tuple[type[exp.Expression], ...] = (
    exp.Create,
    exp.Drop,
    exp.Alter,
    exp.TruncateTable,
)

# Functions that read the filesystem, open network connections, run shell
# commands, or let a query stall a connection. None have a legitimate use in
# generated analytics SQL.
_BLOCKED_FUNCTIONS: frozenset[str] = frozenset(
    {
        "pg_read_file",
        "pg_read_binary_file",
        "pg_ls_dir",
        "pg_stat_file",
        "pg_sleep",
        "pg_sleep_for",
        "pg_sleep_until",
        "lo_import",
        "lo_export",
        "dblink",
        "dblink_exec",
        "dblink_connect",
        "pg_terminate_backend",
        "pg_cancel_backend",
        "pg_reload_conf",
        "pg_rotate_logfile",
        "pg_read_server_files",
        "query_to_xml",
        "set_config",
        "current_setting",
        "pg_logical_emit_message",
        "system",
        "sleep",
        "benchmark",
        "load_file",
    }
)

# Catalogs that expose other tenants structure, roles, or password hashes.
_SYSTEM_SCHEMAS: frozenset[str] = frozenset(
    {
        "pg_catalog",
        "information_schema",
        "pg_toast",
        "pg_temp",
        "mysql",
        "sys",
        "performance_schema",
    }
)

_SENSITIVE_TABLES: frozenset[str] = frozenset(
    {"pg_shadow", "pg_authid", "pg_user", "pg_roles", "pg_settings", "pg_hba_file_rules"}
)

# EXPLAIN is handled separately: it is allowed, but only when it wraps a
# statement that itself passes the guard.
_EXPLAIN_PREFIX = re.compile(r"^\s*explain\b", re.IGNORECASE)
_EXPLAIN_OPTIONS = re.compile(r"^\s*\([^)]*\)")


class SQLGuard:
    """Validates and rewrites SQL before it may touch a user database."""

    def __init__(
        self,
        *,
        dialect: str = "postgres",
        read_only: bool = True,
        allowed_schemas: frozenset[str] | None = None,
        max_joins: int = 10,
        max_rows: int = 10_000,
        force_limit: bool = True,
        allow_system_catalog: bool = False,
    ) -> None:
        self.dialect = dialect
        self.read_only = read_only
        self.allowed_schemas = allowed_schemas
        self.max_joins = max_joins
        self.max_rows = max_rows
        self.force_limit = force_limit
        self.allow_system_catalog = allow_system_catalog

    # -- public API ----------------------------------------------------------

    def validate(self, sql: str) -> GuardResult:
        result = GuardResult(ok=False)

        if not sql or not sql.strip():
            result.errors.append(
                GuardError(GuardViolation.EMPTY_STATEMENT, "No SQL statement was supplied.")
            )
            return result

        if _EXPLAIN_PREFIX.match(sql):
            return self._validate_explain(sql)

        try:
            statements = sqlglot.parse(sql, dialect=self.dialect)
        except ParseError as exc:
            result.errors.append(
                GuardError(GuardViolation.PARSE_ERROR, f"SQL could not be parsed: {exc}")
            )
            return result

        statements = [s for s in statements if s is not None]

        if len(statements) == 0:
            result.errors.append(
                GuardError(GuardViolation.EMPTY_STATEMENT, "No executable statement was found.")
            )
            return result

        # Stacked statements ("SELECT 1; DROP TABLE users") are refused
        # outright rather than by silently executing only the first.
        if len(statements) > 1:
            result.errors.append(
                GuardError(
                    GuardViolation.MULTIPLE_STATEMENTS,
                    f"Only one statement may be executed at a time; found {len(statements)}.",
                )
            )
            return result

        statement = statements[0]

        self._check_statement_type(statement, result)
        if result.errors:
            return result

        self._check_forbidden_functions(statement, result)
        self._check_tables_and_schemas(statement, result)
        self._check_joins(statement, result)

        if result.errors:
            return result

        safe = self._apply_limit(statement, result)
        result.safe_sql = safe.sql(dialect=self.dialect)
        result.ok = True
        return result

    def _validate_explain(self, sql: str) -> GuardResult:
        """Validate the statement an EXPLAIN would plan."""
        payload = _EXPLAIN_PREFIX.sub("", sql, count=1)
        payload = _EXPLAIN_OPTIONS.sub("", payload, count=1)
        inner = self.validate(payload)
        if inner.ok:
            inner.safe_sql = f"EXPLAIN (FORMAT JSON) {inner.safe_sql}"
        return inner

    # -- individual checks ---------------------------------------------------

    def _check_statement_type(self, node: exp.Expression, result: GuardResult) -> None:
        if isinstance(node, _DDL_NODES):
            result.errors.append(
                GuardError(
                    GuardViolation.DDL_BLOCKED,
                    f"{type(node).__name__.upper()} statements are blocked; "
                    "this connection is read-only.",
                )
            )
            return
        if isinstance(node, _DML_NODES):
            result.errors.append(
                GuardError(
                    GuardViolation.DML_BLOCKED,
                    f"{type(node).__name__.upper()} statements are blocked; "
                    "this connection is read-only.",
                )
            )
            return
        if self.read_only and not isinstance(node, _READONLY_STATEMENTS):
            result.errors.append(
                GuardError(
                    GuardViolation.STATEMENT_NOT_ALLOWED,
                    "Only SELECT and WITH statements are permitted; got "
                    f"{type(node).__name__.upper()}.",
                )
            )

    def _check_forbidden_functions(self, node: exp.Expression, result: GuardResult) -> None:
        found: set[str] = set()

        for func in node.find_all(exp.Func):
            name = ""
            try:
                name = (func.sql_name() or "").lower()
            except Exception:  # noqa: BLE001 - sql_name is best-effort
                name = ""
            if name in _BLOCKED_FUNCTIONS:
                found.add(name)

        # Unknown/unsupported functions arrive as Anonymous nodes.
        for anon in node.find_all(exp.Anonymous):
            name = str(anon.this).lower() if anon.this else ""
            if name in _BLOCKED_FUNCTIONS:
                found.add(name)

        for name in sorted(found):
            result.errors.append(
                GuardError(
                    GuardViolation.FUNCTION_BLOCKED,
                    f"Function `{name}` is not permitted in generated queries.",
                )
            )

    def _check_tables_and_schemas(self, node: exp.Expression, result: GuardResult) -> None:
        # CTE names are not real tables; validating them against the schema
        # allowlist would reject every legitimate WITH query.
        cte_names = {(cte.alias_or_name or "").lower() for cte in node.find_all(exp.CTE)}

        seen_tables: set[str] = set()
        seen_schemas: set[str] = set()
        catalog_errors: set[str] = set()
        schema_errors: set[str] = set()

        for table in node.find_all(exp.Table):
            table_name = (table.name or "").lower()
            schema_name = (table.db or "").lower()

            if not table_name or table_name in cte_names:
                continue

            if schema_name:
                seen_schemas.add(schema_name)
            seen_tables.add(f"{schema_name}.{table_name}" if schema_name else table_name)

            if not self.allow_system_catalog:
                if schema_name in _SYSTEM_SCHEMAS:
                    catalog_errors.add(f"Access to system catalog `{schema_name}` is blocked.")
                if table_name in _SENSITIVE_TABLES or table_name.startswith("pg_"):
                    catalog_errors.add(f"Access to system table `{table_name}` is blocked.")

            # An unqualified table is resolved via search_path, so the
            # allowlist is only enforceable when a schema is named explicitly.
            if self.allowed_schemas is not None and schema_name:
                if schema_name not in self.allowed_schemas:
                    allowed = ", ".join(sorted(self.allowed_schemas))
                    schema_errors.add(
                        f"Schema `{schema_name}` is not allowed for this connection "
                        f"(allowed: {allowed})."
                    )

        for message in sorted(catalog_errors):
            result.errors.append(GuardError(GuardViolation.SYSTEM_CATALOG, message))
        for message in sorted(schema_errors):
            result.errors.append(GuardError(GuardViolation.SCHEMA_NOT_ALLOWED, message))

        result.tables = sorted(seen_tables)
        result.schemas = sorted(seen_schemas)

    def _check_joins(self, node: exp.Expression, result: GuardResult) -> None:
        join_count = len(list(node.find_all(exp.Join)))
        result.join_count = join_count
        if join_count > self.max_joins:
            result.errors.append(
                GuardError(
                    GuardViolation.TOO_MANY_JOINS,
                    f"Query uses {join_count} joins; the limit is {self.max_joins}.",
                )
            )

    def _apply_limit(self, node: exp.Expression, result: GuardResult) -> exp.Expression:
        """Force a row ceiling onto the outermost SELECT.

        A missing LIMIT is the most common way a generated query melts a
        production database, so we add one rather than trusting the model to.
        """
        existing = node.args.get("limit")

        if existing is not None:
            result.had_limit = True
            try:
                current = int(existing.expression.this)
            except (AttributeError, TypeError, ValueError):
                # Non-literal LIMIT (parameter or expression): leave untouched
                # but record that we could not verify the ceiling.
                result.warnings.append("LIMIT is not a literal and could not be capped.")
                return node
            if current > self.max_rows:
                result.warnings.append(
                    f"LIMIT {current} exceeds the {self.max_rows}-row ceiling and was reduced."
                )
                result.limit_applied = self.max_rows
                return node.limit(self.max_rows)
            result.limit_applied = current
            return node

        if not self.force_limit:
            return node

        result.warnings.append(f"No LIMIT was present; a {self.max_rows}-row cap was applied.")
        result.limit_applied = self.max_rows
        return node.limit(self.max_rows)


def build_guard(
    *,
    allowed_schemas: list[str] | None = None,
    max_rows: int = 10_000,
    max_joins: int = 10,
    dialect: str = "postgres",
    read_only: bool = True,
) -> SQLGuard:
    """Construct a guard from a database connection's stored security policy."""
    return SQLGuard(
        dialect=dialect,
        read_only=read_only,
        allowed_schemas=(
            frozenset(s.lower() for s in allowed_schemas) if allowed_schemas else None
        ),
        max_joins=max_joins,
        max_rows=max_rows,
    )
