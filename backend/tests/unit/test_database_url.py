"""Tests for control-plane DSN normalisation and pooler detection.

These matter because the production deployment reaches Supabase through
Supavisor in transaction mode, where a prepared statement created by one
statement is not there for the next.
"""

from __future__ import annotations

import pytest

from app.database.session import (
    async_database_url,
    asyncpg_connect_args,
    uses_transaction_pooler,
)

SUPABASE_POOLER = (
    "postgresql://postgres.abcdefghij:secret@aws-0-us-east-1.pooler.supabase.com"
    ":6543/postgres?sslmode=require"
)
SUPABASE_SESSION = (
    "postgresql://postgres.abcdefghij:secret@aws-0-us-east-1.pooler.supabase.com"
    ":5432/postgres?sslmode=require"
)
LOCAL = "postgresql+asyncpg://copilot:copilot_dev_password@postgres:5432/copilot"

# --- URL normalisation ------------------------------------------------------


def test_plain_postgres_scheme_becomes_asyncpg() -> None:
    assert async_database_url(SUPABASE_POOLER).startswith("postgresql+asyncpg://")


def test_sslmode_is_translated_to_asyncpg_ssl() -> None:
    # asyncpg rejects libpq's `sslmode`, but accepts `ssl` with the same values.
    url = async_database_url(SUPABASE_POOLER)
    assert "ssl=require" in url
    assert "sslmode" not in url


def test_sslmode_disable_is_dropped_entirely() -> None:
    url = async_database_url("postgresql://u:p@h:5432/d?sslmode=disable")
    assert "ssl" not in url


def test_pgbouncer_hint_is_stripped() -> None:
    # asyncpg would reject it as an unknown server connection parameter.
    url = async_database_url("postgresql://u:p@h:5432/d?pgbouncer=true")
    assert "pgbouncer" not in url


def test_channel_binding_is_stripped() -> None:
    url = async_database_url("postgresql://u:p@h:5432/d?channel_binding=require")
    assert "channel_binding" not in url


def test_credentials_survive_normalisation() -> None:
    url = async_database_url(SUPABASE_POOLER)
    assert "postgres.abcdefghij:secret@" in url


# --- pooler detection -------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (SUPABASE_POOLER, True),
        (SUPABASE_SESSION, False),
        (LOCAL, False),
        ("postgresql://u:p@h:5432/d?pgbouncer=true", True),
        ("postgresql://u:p@h:5432/d?pgbouncer=TRUE", True),
        ("postgresql://u:p@h:5432/d?pgbouncer=false", False),
    ],
)
def test_transaction_pooler_detection(url: str, expected: bool) -> None:
    assert uses_transaction_pooler(url) is expected


def test_pooler_disables_both_statement_caches() -> None:
    # Either cache left on produces intermittent "prepared statement does not
    # exist" failures, depending on which server connection the pooler picks.
    assert asyncpg_connect_args(SUPABASE_POOLER) == {
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
    }


def test_direct_connection_keeps_statement_caching() -> None:
    assert asyncpg_connect_args(LOCAL) == {}
