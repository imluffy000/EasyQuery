"""Schema synchronisation, caching, and retrieval context building."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.prompts import render_schema_context
from app.database.connectors.base import DatabaseConnector, SchemaSnapshot
from app.models.database_connection import (
    DatabaseConnection,
    DatabaseTable,
    GlossaryTerm,
)
from app.retrieval.retriever import SchemaRetriever, TableCandidate
from app.security.pii import classify_column

log = structlog.get_logger(__name__)

# Schema metadata changes rarely; a chat turn should never pay for
# introspection. Invalidated explicitly on sync.
SCHEMA_CACHE_TTL_SECONDS = 3600


class SchemaService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # -- synchronisation -----------------------------------------------------

    async def sync(
        self, connection: DatabaseConnection, connector: DatabaseConnector
    ) -> SchemaSnapshot:
        """Introspect the live database and replace cached metadata.

        Replacement is wholesale rather than a diff: a dropped column that
        lingers in our cache would be offered to the model and produce SQL
        that fails at execution.
        """
        snapshot = await connector.introspect_schema(list(connection.allowed_schemas))

        await self.session.execute(
            delete(DatabaseTable).where(DatabaseTable.database_id == connection.id)
        )

        for table in snapshot.tables:
            columns: list[dict[str, Any]] = []
            for column in table.columns:
                sensitivity = classify_column(column.name, column.data_type)
                columns.append(
                    {
                        "name": column.name,
                        "data_type": column.data_type,
                        "nullable": column.nullable,
                        "default": column.default,
                        "is_primary_key": column.is_primary_key,
                        "is_unique": column.is_unique,
                        "ordinal": column.ordinal,
                        "comment": column.comment,
                        # Computed at sync time so it is reviewable by an admin
                        # rather than re-derived per query.
                        "sensitivity": sensitivity.value,
                    }
                )

            record = DatabaseTable(
                database_id=connection.id,
                schema_name=table.schema,
                table_name=table.name,
                kind=table.kind,
                description=table.comment or "",
                estimated_rows=table.estimated_rows,
                columns=columns,
                foreign_keys=[
                    {
                        "constraint_name": fk.constraint_name,
                        "column": fk.column,
                        "references_schema": fk.references_schema,
                        "references_table": fk.references_table,
                        "references_column": fk.references_column,
                    }
                    for fk in table.foreign_keys
                ],
                indexes=[
                    {
                        "name": ix.name,
                        "columns": ix.columns,
                        "is_unique": ix.is_unique,
                        "is_primary": ix.is_primary,
                        "method": ix.method,
                    }
                    for ix in table.indexes
                ],
                search_document=" ".join(
                    [table.name, table.schema, table.comment or ""]
                    + [c.name for c in table.columns]
                ),
            )
            self.session.add(record)

        changed = connection.schema_hash != snapshot.schema_hash
        connection.schema_hash = snapshot.schema_hash
        connection.last_synced_at = datetime.now(UTC)
        connection.status = "connected"
        connection.last_error = None
        if changed:
            connection.schema_version += 1

        await self.session.flush()
        log.info(
            "schema_synced",
            database_id=str(connection.id),
            tables=snapshot.table_count,
            columns=snapshot.column_count,
            changed=changed,
        )
        return snapshot

    # -- reads ---------------------------------------------------------------

    async def load_candidates(self, database_id: uuid.UUID) -> list[TableCandidate]:
        rows = (
            (
                await self.session.execute(
                    select(DatabaseTable).where(DatabaseTable.database_id == database_id)
                )
            )
            .scalars()
            .all()
        )

        return [
            TableCandidate(
                schema=row.schema_name,
                name=row.table_name,
                description=row.description or "",
                estimated_rows=row.estimated_rows,
                columns=list(row.columns or []),
                foreign_keys=list(row.foreign_keys or []),
                indexes=list(row.indexes or []),
                kind=row.kind,
            )
            for row in rows
        ]

    async def load_glossary(self, database_id: uuid.UUID) -> dict[str, str]:
        rows = (
            (
                await self.session.execute(
                    select(GlossaryTerm).where(GlossaryTerm.database_id == database_id)
                )
            )
            .scalars()
            .all()
        )
        return {
            row.term: (
                f"{row.definition} (maps to {row.maps_to})" if row.maps_to else row.definition
            )
            for row in rows
        }

    async def build_context(
        self,
        *,
        database_id: uuid.UUID,
        question: str,
        retriever: SchemaRetriever | None = None,
        pinned: list[str] | None = None,
    ) -> tuple[str, list[str], dict[str, str]]:
        """Return (rendered schema context, table names, glossary)."""
        candidates = await self.load_candidates(database_id)
        glossary = await self.load_glossary(database_id)

        if not candidates:
            return ("", [], glossary)

        engine = retriever or SchemaRetriever()
        selected = await engine.retrieve(question, candidates, glossary=glossary, pinned=pinned)
        context = render_schema_context([c.to_context_dict() for c in selected])
        return (context, [c.qualified_name for c in selected], glossary)

    async def schema_tree(self, database_id: uuid.UUID) -> dict[str, Any]:
        """Nested schema -> tables -> columns, for the Schema Explorer."""
        candidates = await self.load_candidates(database_id)
        tree: dict[str, list[dict[str, Any]]] = {}
        for candidate in sorted(candidates, key=lambda c: (c.schema, c.name)):
            tree.setdefault(candidate.schema, []).append(
                {
                    "name": candidate.name,
                    "kind": candidate.kind,
                    "description": candidate.description,
                    "estimated_rows": candidate.estimated_rows,
                    "column_count": len(candidate.columns),
                    "columns": candidate.columns,
                    "foreign_keys": candidate.foreign_keys,
                    "indexes": candidate.indexes,
                }
            )
        return {
            "schemas": [{"name": name, "tables": tables} for name, tables in sorted(tree.items())]
        }
