"""Database connector interface.

Everything above this layer depends on `DatabaseConnector`, never on asyncpg,
psycopg, or a vendor SDK. Adding an engine means adding one subclass and one
registry entry -- no changes in the agent, services, or API layers.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, Self


class Engine(StrEnum):
    POSTGRES = "postgres"
    SUPABASE = "supabase"
    MYSQL = "mysql"
    SQLITE = "sqlite"


class SSLMode(StrEnum):
    DISABLE = "disable"
    ALLOW = "allow"
    PREFER = "prefer"
    REQUIRE = "require"
    VERIFY_CA = "verify-ca"
    VERIFY_FULL = "verify-full"


@dataclass(frozen=True)
class ConnectionConfig:
    """Everything needed to open one connection.

    `password` is plaintext and is expected to live only for the duration of a
    connection attempt -- it is decrypted from storage at the last moment and
    is excluded from `__repr__` so it cannot leak into a traceback or log.
    """

    engine: Engine
    host: str
    port: int
    database: str
    username: str
    password: str = field(repr=False, default="")
    ssl_mode: SSLMode = SSLMode.REQUIRE
    # Security policy -- enforced by the connector *and* the SQL guard.
    read_only: bool = True
    allowed_schemas: tuple[str, ...] = ("public",)
    statement_timeout_seconds: int = 30
    max_rows: int = 10_000
    connect_timeout_seconds: int = 10

    def __repr__(self) -> str:  # pragma: no cover - defensive
        return (
            f"ConnectionConfig(engine={self.engine}, host={self.host}, "
            f"port={self.port}, database={self.database}, username={self.username}, "
            f"password=***, read_only={self.read_only})"
        )


@dataclass
class ColumnInfo:
    name: str
    data_type: str
    nullable: bool
    default: str | None = None
    is_primary_key: bool = False
    is_unique: bool = False
    ordinal: int = 0
    comment: str | None = None
    character_maximum_length: int | None = None
    numeric_precision: int | None = None


@dataclass
class ForeignKeyInfo:
    constraint_name: str
    column: str
    references_schema: str
    references_table: str
    references_column: str


@dataclass
class IndexInfo:
    name: str
    columns: list[str]
    is_unique: bool
    is_primary: bool
    method: str | None = None


@dataclass
class TableInfo:
    schema: str
    name: str
    kind: str = "table"  # table | view | materialized_view
    comment: str | None = None
    estimated_rows: int | None = None
    columns: list[ColumnInfo] = field(default_factory=list)
    foreign_keys: list[ForeignKeyInfo] = field(default_factory=list)
    indexes: list[IndexInfo] = field(default_factory=list)

    @property
    def qualified_name(self) -> str:
        return f"{self.schema}.{self.name}"

    @property
    def primary_key_columns(self) -> list[str]:
        return [c.name for c in self.columns if c.is_primary_key]


@dataclass
class SchemaSnapshot:
    """A point-in-time picture of a database's structure."""

    database_id: uuid.UUID | None
    schemas: list[str]
    tables: list[TableInfo]
    introspected_at: datetime
    # Stable hash of the structure -- used to detect drift without a diff.
    schema_hash: str = ""

    @property
    def table_count(self) -> int:
        return len(self.tables)

    @property
    def column_count(self) -> int:
        return sum(len(t.columns) for t in self.tables)


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    duration_ms: int
    truncated: bool = False
    notices: list[str] = field(default_factory=list)


@dataclass
class ExplainResult:
    """Parsed output of EXPLAIN, used for cost gating before execution."""

    total_cost: float
    estimated_rows: int
    plan: dict[str, Any]
    has_sequential_scan: bool = False
    scanned_relations: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ConnectionTestResult:
    ok: bool
    message: str
    server_version: str | None = None
    latency_ms: int | None = None
    is_read_only_role: bool | None = None


class ConnectorError(Exception):
    """Base for connector failures that are safe to surface to a user."""

    def __init__(self, message: str, *, code: str = "DATABASE_ERROR") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class QueryTimeout(ConnectorError):
    def __init__(self, seconds: int) -> None:
        super().__init__(
            f"The query exceeded the configured {seconds}-second limit.",
            code="QUERY_TIMEOUT",
        )


class PermissionDenied(ConnectorError):
    def __init__(self, message: str = "The database role lacks permission for this query.") -> None:
        super().__init__(message, code="DB_PERMISSION_DENIED")


class DatabaseConnector(ABC):
    """Vendor-neutral database access."""

    engine: Engine

    def __init__(self, config: ConnectionConfig) -> None:
        self.config = config

    # -- lifecycle -----------------------------------------------------------

    async def __aenter__(self) -> Self:
        await self.connect()
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.close()

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...

    # -- operations ----------------------------------------------------------

    @abstractmethod
    async def test_connection(self) -> ConnectionTestResult: ...

    @abstractmethod
    async def introspect_schema(self, schemas: list[str] | None = None) -> SchemaSnapshot: ...

    @abstractmethod
    async def execute(
        self, sql: str, *, timeout_seconds: int | None = None, max_rows: int | None = None
    ) -> QueryResult: ...

    @abstractmethod
    async def explain(self, sql: str) -> ExplainResult: ...

    @abstractmethod
    async def health_check(self) -> bool: ...

    @property
    def dialect(self) -> str:
        """sqlglot dialect name for this engine."""
        return "postgres" if self.engine in (Engine.POSTGRES, Engine.SUPABASE) else str(self.engine)
