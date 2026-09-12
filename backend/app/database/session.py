"""Application-database session management.

This is the *control-plane* database (users, workspaces, query history) -- not
the customer databases the copilot queries. Those go through
`app.database.manager`.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy import NullPool
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.engine import make_url

from app.config.settings import Settings

# Supabase's Supavisor listens for transaction-mode pooling on this port;
# session mode (and a direct connection) is 5432.
TRANSACTION_POOLER_PORT = 6543

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def async_database_url(url: str) -> str:
    """Convert a normalized PostgreSQL DSN to SQLAlchemy's asyncpg form."""
    parsed = make_url(url)
    if parsed.drivername == "postgresql":
        parsed = parsed.set(drivername="postgresql+asyncpg")
    # ``sslmode`` and ``channel_binding`` are psycopg/libpq options. asyncpg
    # rejects both, but does accept its equivalent ``ssl`` mode.
    sslmode = parsed.query.get("sslmode")
    # ``pgbouncer=true`` is a hint for the application, not a server option;
    # asyncpg would reject it as an unknown connection parameter.
    parsed = parsed.difference_update_query(["sslmode", "channel_binding", "pgbouncer"])
    if isinstance(sslmode, str) and sslmode.lower() != "disable":
        parsed = parsed.update_query_dict({"ssl": sslmode})
    # NOT str(parsed): SQLAlchemy's URL is a NamedTuple whose __repr__ masks
    # the password, and __str__ falls back to it. Stringifying the URL that way
    # yields a DSN whose password is the literal "***", so every connection
    # fails authentication. render_as_string also percent-encodes the password,
    # which matters for the generated ones managed Postgres hands out.
    return parsed.render_as_string(hide_password=False)


def uses_transaction_pooler(url: str) -> bool:
    """Is this DSN pointing at a transaction-mode connection pooler?

    Supabase (Supavisor) and PgBouncer in transaction mode hand a different
    server connection to consecutive statements, so a prepared statement
    created by one query is gone by the next.
    """
    parsed = make_url(url)
    pgbouncer = parsed.query.get("pgbouncer")
    if isinstance(pgbouncer, str) and pgbouncer.lower() in {"true", "1", "yes"}:
        return True
    return parsed.port == TRANSACTION_POOLER_PORT


def asyncpg_connect_args(url: str) -> dict[str, Any]:
    """Driver arguments a transaction pooler requires, or nothing.

    Both caches have to go: ``statement_cache_size`` is asyncpg's own, and
    ``prepared_statement_cache_size`` is SQLAlchemy's asyncpg dialect layer.
    Leaving either on produces intermittent ``prepared statement
    "__asyncpg_stmt_N__" does not exist`` errors under load -- intermittent
    because it depends on which server connection the pooler picks.
    """
    if not uses_transaction_pooler(url):
        return {}
    return {"statement_cache_size": 0, "prepared_statement_cache_size": 0}


def init_engine(settings: Settings) -> AsyncEngine:
    """Create the pooled engine. Called once during application start-up."""
    global _engine, _session_factory

    if _engine is not None:
        return _engine

    raw_url = str(settings.database_url)
    database_url = async_database_url(raw_url)

    engine_kwargs: dict[str, Any] = {"echo": False}
    if uses_transaction_pooler(raw_url):
        # The pooler already multiplexes connections, so a second pool in
        # front of it only holds server slots idle -- and those are the
        # scarce resource on a managed Postgres. NullPool defers entirely.
        engine_kwargs["poolclass"] = NullPool
        engine_kwargs["connect_args"] = asyncpg_connect_args(raw_url)
    else:
        engine_kwargs.update(
            pool_size=10,
            max_overflow=20,
            pool_timeout=30,
            # Recycle below typical cloud idle-connection timeouts so a pooled
            # connection is never handed out already dead.
            pool_recycle=1800,
            pool_pre_ping=True,
        )

    _engine = create_async_engine(database_url, **engine_kwargs)
    _session_factory = async_sessionmaker(
        _engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )
    return _engine


def get_engine() -> AsyncEngine:
    if _engine is None:
        raise RuntimeError("Database engine is not initialised.")
    return _engine


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: one transaction per request.

    Commits on success, rolls back on any exception, always closes.
    """
    if _session_factory is None:
        raise RuntimeError("Session factory is not initialised.")

    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
