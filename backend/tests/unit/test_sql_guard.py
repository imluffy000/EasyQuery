"""Adversarial tests for the SQL guard.

These encode the threat model: an LLM (or a prompt-injected database value)
producing SQL that tries to escape read-only analytics access.
"""

from __future__ import annotations

import pytest

from app.security.sql_guard import GuardViolation, SQLGuard, build_guard


@pytest.fixture
def guard() -> SQLGuard:
    return build_guard(allowed_schemas=["public", "analytics"], max_rows=1000, max_joins=5)


# --- statements that must be allowed ---------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 1",
        "SELECT id, email FROM public.users WHERE status = 'active'",
        "SELECT count(*) FROM orders",
        "WITH recent AS (SELECT * FROM orders LIMIT 10) SELECT * FROM recent",
        "SELECT u.id, o.total_amount FROM users u JOIN orders o ON o.user_id = u.id",
        "SELECT date_trunc('month', created_at) AS m, sum(total_amount) FROM orders GROUP BY 1",
        "SELECT * FROM users UNION SELECT * FROM users",
    ],
)
def test_allows_read_only_statements(guard: SQLGuard, sql: str) -> None:
    result = guard.validate(sql)
    assert result.ok, f"expected allowed, got {result.error_codes}: {result.first_message}"
    assert result.safe_sql


# --- write / DDL must be blocked -------------------------------------------


@pytest.mark.parametrize(
    ("sql", "code"),
    [
        ("INSERT INTO users (email) VALUES ('a@b.c')", GuardViolation.DML_BLOCKED),
        ("UPDATE users SET status = 'admin'", GuardViolation.DML_BLOCKED),
        ("DELETE FROM users", GuardViolation.DML_BLOCKED),
        ("DROP TABLE users", GuardViolation.DDL_BLOCKED),
        ("ALTER TABLE users ADD COLUMN x int", GuardViolation.DDL_BLOCKED),
        ("TRUNCATE TABLE users", GuardViolation.DDL_BLOCKED),
        ("CREATE TABLE t (id int)", GuardViolation.DDL_BLOCKED),
    ],
)
def test_blocks_writes(guard: SQLGuard, sql: str, code: GuardViolation) -> None:
    result = guard.validate(sql)
    assert not result.ok
    assert code.value in result.error_codes


def test_blocks_grant_and_revoke(guard: SQLGuard) -> None:
    for sql in ("GRANT ALL ON users TO public", "REVOKE ALL ON users FROM public"):
        result = guard.validate(sql)
        assert not result.ok, f"{sql} must not be allowed"


# --- stacked statements -----------------------------------------------------


def test_blocks_stacked_statements(guard: SQLGuard) -> None:
    result = guard.validate("SELECT 1; DROP TABLE users")
    assert not result.ok
    assert GuardViolation.MULTIPLE_STATEMENTS.value in result.error_codes


def test_blocks_stacked_statement_hidden_by_comment(guard: SQLGuard) -> None:
    result = guard.validate("SELECT 1; -- harmless\nDROP TABLE users")
    assert not result.ok


# --- dangerous functions ----------------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT pg_read_file('/etc/passwd')",
        "SELECT pg_sleep(60)",
        "SELECT lo_import('/etc/shadow')",
        "SELECT dblink('host=evil.com', 'SELECT 1')",
        "SELECT pg_terminate_backend(1)",
        "SELECT PG_SLEEP(10)",
        "SELECT id FROM users WHERE pg_sleep(5) IS NULL",
    ],
)
def test_blocks_dangerous_functions(guard: SQLGuard, sql: str) -> None:
    result = guard.validate(sql)
    assert not result.ok, f"{sql} must be blocked"
    assert GuardViolation.FUNCTION_BLOCKED.value in result.error_codes


# --- system catalogs --------------------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM pg_catalog.pg_tables",
        "SELECT * FROM information_schema.columns",
        "SELECT * FROM pg_shadow",
        "SELECT usename, passwd FROM pg_authid",
    ],
)
def test_blocks_system_catalog(guard: SQLGuard, sql: str) -> None:
    result = guard.validate(sql)
    assert not result.ok, f"{sql} must be blocked"
    assert GuardViolation.SYSTEM_CATALOG.value in result.error_codes


# --- schema allowlist -------------------------------------------------------


def test_blocks_disallowed_schema(guard: SQLGuard) -> None:
    result = guard.validate("SELECT * FROM secrets.api_keys")
    assert not result.ok
    assert GuardViolation.SCHEMA_NOT_ALLOWED.value in result.error_codes


def test_allows_listed_schema(guard: SQLGuard) -> None:
    assert guard.validate("SELECT * FROM analytics.events").ok


def test_cte_name_is_not_treated_as_schema(guard: SQLGuard) -> None:
    sql = "WITH totals AS (SELECT 1 AS n) SELECT n FROM totals"
    assert guard.validate(sql).ok


# --- join ceiling -----------------------------------------------------------


def test_blocks_excessive_joins() -> None:
    g = build_guard(max_joins=2)
    sql = (
        "SELECT * FROM a "
        "JOIN b ON b.id = a.id "
        "JOIN c ON c.id = a.id "
        "JOIN d ON d.id = a.id"
    )
    result = g.validate(sql)
    assert not result.ok
    assert GuardViolation.TOO_MANY_JOINS.value in result.error_codes


# --- LIMIT enforcement ------------------------------------------------------


def test_injects_limit_when_absent(guard: SQLGuard) -> None:
    result = guard.validate("SELECT * FROM users")
    assert result.ok
    assert result.limit_applied == 1000
    assert "LIMIT 1000" in (result.safe_sql or "").upper()


def test_reduces_limit_above_ceiling(guard: SQLGuard) -> None:
    result = guard.validate("SELECT * FROM users LIMIT 999999")
    assert result.ok
    assert result.limit_applied == 1000
    assert "LIMIT 1000" in (result.safe_sql or "").upper()


def test_preserves_limit_below_ceiling(guard: SQLGuard) -> None:
    result = guard.validate("SELECT * FROM users LIMIT 25")
    assert result.ok
    assert result.had_limit
    assert result.limit_applied == 25


# --- EXPLAIN ----------------------------------------------------------------


def test_allows_explain_of_select(guard: SQLGuard) -> None:
    result = guard.validate("EXPLAIN (FORMAT JSON) SELECT * FROM users")
    assert result.ok
    assert (result.safe_sql or "").upper().startswith("EXPLAIN")


def test_blocks_explain_of_delete(guard: SQLGuard) -> None:
    result = guard.validate("EXPLAIN DELETE FROM users")
    assert not result.ok


# --- malformed / empty ------------------------------------------------------


def test_rejects_empty(guard: SQLGuard) -> None:
    assert not guard.validate("").ok
    assert not guard.validate("   ").ok


def test_reports_metadata(guard: SQLGuard) -> None:
    result = guard.validate(
        "SELECT u.id FROM public.users u JOIN public.orders o ON o.user_id = u.id"
    )
    assert result.ok
    assert result.join_count == 1
    assert "public.users" in result.tables
    assert "public" in result.schemas
