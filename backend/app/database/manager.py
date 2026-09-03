"""Connector factory and pool cache.

This is the only place that turns a stored `DatabaseConnection` row into a live
connector. Credentials are decrypted here, at the last possible moment, and the
plaintext never travels further up the stack -- callers receive a connector,
not a password.

Pools are cached per connection id so a chat turn does not pay TCP + TLS setup
on every query.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import TYPE_CHECKING

import structlog

from app.database.connectors.base import (
    ConnectionConfig,
    DatabaseConnector,
    Engine,
    SSLMode,
)
from app.database.connectors.postgres import PostgresConnector, SupabaseConnector
from app.security.encryption import SecretBox

if TYPE_CHECKING:
    from app.models.database_connection import DatabaseConnection

log = structlog.get_logger(__name__)

_REGISTRY: dict[Engine, type[DatabaseConnector]] = {
    Engine.POSTGRES: PostgresConnector,
    Engine.SUPABASE: SupabaseConnector,
}


def register_connector(engine: Engine, connector: type[DatabaseConnector]) -> None:
    """Add an engine without touching the agent, services, or API layers."""
    _REGISTRY[engine] = connector


def supported_engines() -> list[str]:
    return sorted(e.value for e in _REGISTRY)


class ConnectionManager:
    """Owns the lifetime of every user-database connector."""

    def __init__(self, secret_box: SecretBox) -> None:
        self._secret_box = secret_box
        self._connectors: dict[uuid.UUID, DatabaseConnector] = {}
        self._lock = asyncio.Lock()

    def build_config(self, record: DatabaseConnection) -> ConnectionConfig:
        """Decrypt stored credentials into a connection config."""
        password = self._secret_box.decrypt(record.encrypted_password)
        return ConnectionConfig(
            engine=Engine(record.engine),
            host=record.host,
            port=record.port,
            database=record.database_name,
            username=record.username,
            password=password,
            ssl_mode=SSLMode(record.ssl_mode),
            read_only=record.read_only,
            allowed_schemas=tuple(record.allowed_schemas or ("public",)),
            statement_timeout_seconds=record.query_timeout_seconds,
            max_rows=record.max_rows,
        )

    def build_connector(self, config: ConnectionConfig) -> DatabaseConnector:
        connector_cls = _REGISTRY.get(config.engine)
        if connector_cls is None:
            raise ValueError(f"No connector registered for engine '{config.engine}'.")
        return connector_cls(config)

    async def get(self, record: DatabaseConnection) -> DatabaseConnector:
        """Return a pooled connector for this connection, creating it if needed."""
        existing = self._connectors.get(record.id)
        if existing is not None:
            return existing

        async with self._lock:
            # Re-check: another coroutine may have created it while we waited.
            existing = self._connectors.get(record.id)
            if existing is not None:
                return existing

            connector = self.build_connector(self.build_config(record))
            await connector.connect()
            self._connectors[record.id] = connector
            log.info(
                "connector_opened",
                database_id=str(record.id),
                engine=record.engine,
                read_only=record.read_only,
            )
            return connector

    async def transient(self, config: ConnectionConfig) -> DatabaseConnector:
        """A connector that is *not* cached -- used for 'Test connection'."""
        return self.build_connector(config)

    async def invalidate(self, database_id: uuid.UUID) -> None:
        """Drop a cached connector, e.g. after credentials change."""
        async with self._lock:
            connector = self._connectors.pop(database_id, None)
        if connector is not None:
            await connector.close()
            log.info("connector_closed", database_id=str(database_id))

    async def close_all(self) -> None:
        async with self._lock:
            connectors = list(self._connectors.values())
            self._connectors.clear()
        for connector in connectors:
            try:
                await connector.close()
            except Exception as exc:  # noqa: BLE001 - shutdown is best-effort
                log.warning("connector_close_failed", error=str(exc))
