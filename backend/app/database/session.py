"""Application-database session management.

This is the *control-plane* database (users, workspaces, query history) -- not
the customer databases the copilot queries. Those go through
`app.database.manager`.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config.settings import Settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_engine(settings: Settings) -> AsyncEngine:
    """Create the pooled engine. Called once during application start-up."""
    global _engine, _session_factory

    if _engine is not None:
        return _engine

    _engine = create_async_engine(
        str(settings.database_url),
        echo=False,
        pool_size=10,
        max_overflow=20,
        pool_timeout=30,
        # Recycle below typical cloud idle-connection timeouts so a pooled
        # connection is never handed out already dead.
        pool_recycle=1800,
        pool_pre_ping=True,
    )
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
