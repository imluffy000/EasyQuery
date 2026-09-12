"""Alembic environment.

The database URL comes from application settings, never from alembic.ini, so
migrations cannot be run against a different database than the app uses.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config.settings import get_settings
from app.database.session import async_database_url, asyncpg_connect_args

# Importing the models package registers every table on Base.metadata.
from app.models import Base  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

settings = get_settings()
raw_database_url = str(settings.database_url)
database_url = async_database_url(raw_database_url)
config.set_main_option("sqlalchemy.url", database_url)


def _configure(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Detect column type changes, not just added/dropped columns.
        compare_type=True,
        compare_server_default=True,
        include_schemas=False,
    )


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection: Connection) -> None:
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        # Empty unless the DSN points at a transaction pooler, which cannot
        # keep prepared statements alive between statements.
        connect_args=asyncpg_connect_args(raw_database_url),
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_do_run)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
