"""Integration tests against a real PostgreSQL instance.

Requires the compose stack (`make up`). These assert on the seeded demo
database, which is deterministic, so counts are exact rather than approximate.
"""

from __future__ import annotations

import os

import pytest

from app.database.connectors.base import (
    ConnectionConfig,
    ConnectorError,
    Engine,
    PermissionDenied,
    SSLMode,
)
from app.database.connectors.postgres import PostgresConnector
from app.security.sql_guard import build_guard

PG_HOST = os.getenv("TEST_PG_HOST", "postgres")
PG_PORT = int(os.getenv("TEST_PG_PORT", "5432"))

pytestmark = pytest.mark.integration


def make_config(*, user: str = "copilot", password: str = "copilot_dev_password") -> ConnectionConfig:
    return ConnectionConfig(
        engine=Engine.POSTGRES,
        host=PG_HOST,
        port=PG_PORT,
        database="demo_analytics",
        username=user,
        password=password,
        ssl_mode=SSLMode.DISABLE,
        read_only=True,
        allowed_schemas=("public",),
        statement_timeout_seconds=15,
        max_rows=1000,
    )


@pytest.fixture
async def connector():
    c = PostgresConnector(make_config())
    await c.connect()
    try:
        yield c
    finally:
        await c.close()


async def test_connection_succeeds(connector: PostgresConnector) -> None:
    result = await connector.test_connection()
    assert result.ok
    assert result.server_version and "PostgreSQL" in result.server_version
    assert result.latency_ms is not None


async def test_introspection_finds_seeded_tables(connector: PostgresConnector) -> None:
    snapshot = await connector.introspect_schema(["public"])
    names = {t.name for t in snapshot.tables}

    assert {"orders", "customers", "order_items", "products", "payments"} <= names
    assert snapshot.schema_hash, "a schema hash is required for drift detection"

    orders = next(t for t in snapshot.tables if t.name == "orders")
    assert orders.primary_key_columns == ["id"]
    assert orders.comment == "Customer orders"

    columns = {c.name: c for c in orders.columns}
    assert columns["total_amount"].data_type.startswith("numeric")
    assert columns["customer_id"].nullable is False
    assert columns["total_amount"].comment == "Order gross value in INR"

    # The foreign key the retriever relies on for join expansion.
    fks = {(fk.column, fk.references_table) for fk in orders.foreign_keys}
    assert ("customer_id", "customers") in fks

    assert any(ix.name == "ix_orders_created_at" for ix in orders.indexes)


async def test_schema_hash_is_stable(connector: PostgresConnector) -> None:
    first = await connector.introspect_schema(["public"])
    second = await connector.introspect_schema(["public"])
    assert first.schema_hash == second.schema_hash


async def test_execute_returns_rows(connector: PostgresConnector) -> None:
    result = await connector.execute("SELECT count(*) AS n FROM orders")
    assert result.row_count == 1
    assert result.rows[0]["n"] == 18000
    assert result.columns == ["n"]
    assert result.duration_ms >= 0


async def test_numeric_and_timestamp_are_json_safe(connector: PostgresConnector) -> None:
    result = await connector.execute(
        "SELECT total_amount, created_at FROM orders ORDER BY id LIMIT 1"
    )
    row = result.rows[0]
    # numeric -> float, timestamptz -> ISO string, so the row survives JSON.
    assert isinstance(row["total_amount"], float)
    assert isinstance(row["created_at"], str)


async def test_row_limit_is_enforced(connector: PostgresConnector) -> None:
    result = await connector.execute("SELECT id FROM orders LIMIT 50", max_rows=10)
    assert result.row_count == 10
    assert result.truncated is True


async def test_explain_reports_cost(connector: PostgresConnector) -> None:
    explain = await connector.explain("SELECT * FROM orders WHERE created_at > now() - interval '30 days'")
    assert explain.total_cost > 0
    assert "orders" in explain.scanned_relations


async def test_read_only_transaction_blocks_writes(connector: PostgresConnector) -> None:
    """Even as a superuser, the READ ONLY transaction refuses a write."""
    with pytest.raises(ConnectorError):
        await connector.execute("INSERT INTO categories (id, name, slug) VALUES (98, 'x', 'x')")


async def test_readonly_role_cannot_write() -> None:
    """The database-level layer, independent of the application guard."""
    c = PostgresConnector(
        make_config(user="copilot_readonly", password="copilot_readonly_pw")
    )
    await c.connect()
    try:
        ok = await c.execute("SELECT count(*) AS n FROM orders")
        assert ok.rows[0]["n"] == 18000

        with pytest.raises((PermissionDenied, ConnectorError)):
            await c.execute("INSERT INTO categories (id, name, slug) VALUES (97, 'y', 'y')")
    finally:
        await c.close()


async def test_statement_timeout_fires() -> None:
    """A long query is stopped by PostgreSQL, not left to run."""
    config = ConnectionConfig(
        **{**make_config().__dict__, "statement_timeout_seconds": 1}
    )
    c = PostgresConnector(config)
    await c.connect()
    try:
        with pytest.raises(ConnectorError) as excinfo:
            await c.execute("SELECT pg_sleep(5)", timeout_seconds=1)
        assert excinfo.value.code in {"QUERY_TIMEOUT", "DATABASE_ERROR"}
    finally:
        await c.close()


async def test_guard_and_connector_together(connector: PostgresConnector) -> None:
    """The full path: validate, then execute only what the guard returned."""
    guard = build_guard(allowed_schemas=["public"], max_rows=5)

    verdict = guard.validate("SELECT id, total_amount FROM public.orders ORDER BY id")
    assert verdict.ok and verdict.safe_sql

    result = await connector.execute(verdict.safe_sql, max_rows=5)
    assert result.row_count == 5

    blocked = guard.validate("DELETE FROM public.orders")
    assert not blocked.ok
    assert blocked.safe_sql is None
