"""User database connections and their cached schema metadata."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Timestamps, UUIDPrimaryKey
from app.models.tenancy import Workspace


class DatabaseConnection(UUIDPrimaryKey, Timestamps, Base):
    """A connection to a customer database.

    The password column holds a Fernet token, never plaintext, and is excluded
    from every response schema. There is deliberately no `connection_string`
    column -- a DSN would put the password back into a loggable string.
    """

    __tablename__ = "database_connections"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="workspace_id_name"),
        Index("ix_database_connections_workspace", "workspace_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    environment: Mapped[str] = mapped_column(String(20), nullable=False, default="development")
    engine: Mapped[str] = mapped_column(String(20), nullable=False, default="postgres")

    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(nullable=False, default=5432)
    database_name: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    encrypted_password: Mapped[str] = mapped_column(Text, nullable=False)
    ssl_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="require")

    # --- security policy, enforced by both the connector and the SQL guard ---
    read_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allowed_schemas: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=lambda: ["public"]
    )
    query_timeout_seconds: Mapped[int] = mapped_column(nullable=False, default=30)
    max_rows: Mapped[int] = mapped_column(nullable=False, default=10_000)
    allow_sample_values: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # --- status ---
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    schema_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    schema_version: Mapped[int] = mapped_column(nullable=False, default=0)

    workspace: Mapped[Workspace] = relationship(back_populates="databases")
    tables: Mapped[list[DatabaseTable]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )
    glossary_terms: Mapped[list[GlossaryTerm]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )


class DatabaseTable(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "database_tables"
    __table_args__ = (
        UniqueConstraint(
            "database_id", "schema_name", "table_name", name="database_id_schema_name_table_name"
        ),
        Index("ix_database_tables_database", "database_id"),
    )

    database_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("database_connections.id", ondelete="CASCADE"),
        nullable=False,
    )
    schema_name: Mapped[str] = mapped_column(String(128), nullable=False)
    table_name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False, default="table")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    estimated_rows: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Denormalised structure, kept as JSONB so schema retrieval is one row read
    # rather than a three-way join per candidate table.
    columns: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    foreign_keys: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    indexes: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)

    # Text used to build the retrieval embedding.
    search_document: Mapped[str] = mapped_column(Text, nullable=False, default="")

    connection: Mapped[DatabaseConnection] = relationship(back_populates="tables")

    @property
    def qualified_name(self) -> str:
        return f"{self.schema_name}.{self.table_name}"


class GlossaryTerm(UUIDPrimaryKey, Timestamps, Base):
    """Admin-defined business definitions (spec section 18).

    These are authoritative: the planner is told to prefer a glossary
    definition over its own interpretation, which is the single cheapest way
    to raise text-to-SQL accuracy on a specific schema.
    """

    __tablename__ = "business_glossary"
    __table_args__ = (UniqueConstraint("database_id", "term", name="database_id_term"),)

    database_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("database_connections.id", ondelete="CASCADE"),
        nullable=False,
    )
    term: Mapped[str] = mapped_column(String(120), nullable=False)
    definition: Mapped[str] = mapped_column(Text, nullable=False)
    maps_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    connection: Mapped[DatabaseConnection] = relationship(back_populates="glossary_terms")
