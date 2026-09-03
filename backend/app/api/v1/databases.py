"""Database connection management, testing, and schema synchronisation."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import (
    ConnectorDep,
    DatabaseDep,
    ManagerDep,
    SessionDep,
    WorkspaceDep,
)
from app.database.connectors.base import (
    ConnectionConfig,
    ConnectorError,
    Engine,
    SSLMode,
)
from app.database.manager import supported_engines
from app.models.database_connection import DatabaseConnection, GlossaryTerm
from app.schemas.api import (
    ConnectionTestOut,
    DatabaseConnectionOut,
    DatabaseCreate,
    DatabaseUpdate,
    GlossaryTermIn,
    GlossaryTermOut,
    SchemaSyncOut,
)
from app.security import audit
from app.security.audit import AuditEvent
from app.security.encryption import SecretBox
from app.security.rbac import Permission
from app.services.schema_service import SchemaService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["databases"])


def _secret_box(request: Request) -> SecretBox:
    box = getattr(request.app.state, "secret_box", None)
    if box is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "NOT_READY", "message": "Encryption is not configured."},
        )
    return box


@router.get("/engines", response_model=list[str])
async def list_engines(context: WorkspaceDep) -> list[str]:
    return supported_engines()


@router.get("/databases", response_model=list[DatabaseConnectionOut])
async def list_databases(context: WorkspaceDep, session: SessionDep) -> list[DatabaseConnectionOut]:
    context.require(Permission.VIEW_SCHEMA)
    rows = (
        (
            await session.execute(
                select(DatabaseConnection)
                .where(DatabaseConnection.workspace_id == context.workspace.id)
                .order_by(DatabaseConnection.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [DatabaseConnectionOut.model_validate(r) for r in rows]


@router.post(
    "/databases", response_model=DatabaseConnectionOut, status_code=status.HTTP_201_CREATED
)
async def create_database(
    payload: DatabaseCreate,
    request: Request,
    context: WorkspaceDep,
    session: SessionDep,
) -> DatabaseConnectionOut:
    context.require(Permission.MANAGE_DATABASES)

    connection = DatabaseConnection(
        workspace_id=context.workspace.id,
        created_by=context.user.id,
        name=payload.name,
        engine=payload.engine,
        environment=payload.environment,
        host=payload.host,
        port=payload.port,
        database_name=payload.database_name,
        username=payload.username,
        # Encrypted immediately; the plaintext is not retained.
        encrypted_password=_secret_box(request).encrypt(payload.password),
        ssl_mode=payload.ssl_mode,
        read_only=payload.read_only,
        allowed_schemas=payload.allowed_schemas,
        # A connection may only tighten the workspace ceiling.
        query_timeout_seconds=min(
            payload.query_timeout_seconds, context.workspace.query_timeout_seconds
        ),
        max_rows=min(payload.max_rows, context.workspace.max_rows),
        allow_sample_values=payload.allow_sample_values,
        status="pending",
    )
    session.add(connection)
    await session.flush()

    await audit.record(
        session,
        event=AuditEvent.DATABASE_CONNECTED,
        workspace_id=context.workspace.id,
        user_id=context.user.id,
        database_id=connection.id,
        metadata={"engine": payload.engine, "host": payload.host, "read_only": payload.read_only},
    )
    return DatabaseConnectionOut.model_validate(connection)


@router.get("/databases/{database_id}", response_model=DatabaseConnectionOut)
async def get_database(connection: DatabaseDep, context: WorkspaceDep) -> DatabaseConnectionOut:
    context.require(Permission.VIEW_SCHEMA)
    return DatabaseConnectionOut.model_validate(connection)


@router.patch("/databases/{database_id}", response_model=DatabaseConnectionOut)
async def update_database(
    payload: DatabaseUpdate,
    request: Request,
    connection: DatabaseDep,
    context: WorkspaceDep,
    session: SessionDep,
    manager: ManagerDep,
) -> DatabaseConnectionOut:
    context.require(Permission.MANAGE_DATABASES)

    data = payload.model_dump(exclude_unset=True)
    if "password" in data and data["password"]:
        connection.encrypted_password = _secret_box(request).encrypt(data.pop("password"))
    data.pop("password", None)

    for field, value in data.items():
        if value is not None:
            setattr(connection, field, value)

    connection.max_rows = min(connection.max_rows, context.workspace.max_rows)
    connection.query_timeout_seconds = min(
        connection.query_timeout_seconds, context.workspace.query_timeout_seconds
    )

    # The cached connector holds the old credentials and old session settings.
    await manager.invalidate(connection.id)
    await session.flush()

    await audit.record(
        session,
        event=AuditEvent.DATABASE_UPDATED,
        workspace_id=context.workspace.id,
        user_id=context.user.id,
        database_id=connection.id,
        metadata={"fields": sorted(data.keys())},
    )
    return DatabaseConnectionOut.model_validate(connection)


@router.delete("/databases/{database_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_database(
    connection: DatabaseDep,
    context: WorkspaceDep,
    session: SessionDep,
    manager: ManagerDep,
) -> None:
    context.require(Permission.MANAGE_DATABASES)
    database_id = connection.id
    await manager.invalidate(database_id)
    await session.delete(connection)
    await audit.record(
        session,
        event=AuditEvent.DATABASE_DISCONNECTED,
        workspace_id=context.workspace.id,
        user_id=context.user.id,
        metadata={"database_id": str(database_id)},
    )


@router.post("/databases/test", response_model=ConnectionTestOut)
async def test_new_connection(
    payload: DatabaseCreate,
    context: WorkspaceDep,
    manager: ManagerDep,
) -> ConnectionTestOut:
    """Test credentials before saving them (wizard step 4)."""
    context.require(Permission.MANAGE_DATABASES)

    config = ConnectionConfig(
        engine=Engine(payload.engine),
        host=payload.host,
        port=payload.port,
        database=payload.database_name,
        username=payload.username,
        password=payload.password,
        ssl_mode=SSLMode(payload.ssl_mode),
        read_only=payload.read_only,
        allowed_schemas=tuple(payload.allowed_schemas),
        statement_timeout_seconds=payload.query_timeout_seconds,
        max_rows=payload.max_rows,
    )
    connector = await manager.transient(config)
    try:
        result = await connector.test_connection()
    finally:
        await connector.close()
    return ConnectionTestOut(**result.__dict__)


@router.post("/databases/{database_id}/test", response_model=ConnectionTestOut)
async def test_existing_connection(
    connection: DatabaseDep,
    context: WorkspaceDep,
    connector: ConnectorDep,
    session: SessionDep,
) -> ConnectionTestOut:
    context.require(Permission.VIEW_SCHEMA)
    result = await connector.test_connection()

    connection.last_tested_at = datetime.now(UTC)
    connection.status = "connected" if result.ok else "error"
    connection.last_error = None if result.ok else result.message
    if not result.ok:
        await audit.record(
            session,
            event=AuditEvent.DATABASE_TEST_FAILED,
            workspace_id=context.workspace.id,
            user_id=context.user.id,
            database_id=connection.id,
            metadata={"message": result.message},
        )
    return ConnectionTestOut(**result.__dict__)


@router.post("/databases/{database_id}/sync-schema", response_model=SchemaSyncOut)
async def sync_schema(
    connection: DatabaseDep,
    context: WorkspaceDep,
    connector: ConnectorDep,
    session: SessionDep,
) -> SchemaSyncOut:
    context.require(Permission.SYNC_SCHEMA)
    previous_hash = connection.schema_hash

    service = SchemaService(session)
    try:
        snapshot = await service.sync(connection, connector)
    except ConnectorError as exc:
        connection.status = "error"
        connection.last_error = exc.message
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": exc.code, "message": exc.message},
        ) from exc

    await audit.record(
        session,
        event=AuditEvent.SCHEMA_SYNCED,
        workspace_id=context.workspace.id,
        user_id=context.user.id,
        database_id=connection.id,
        metadata={"tables": snapshot.table_count, "columns": snapshot.column_count},
    )
    return SchemaSyncOut(
        tables=snapshot.table_count,
        columns=snapshot.column_count,
        schema_changed=previous_hash != snapshot.schema_hash,
        schema_version=connection.schema_version,
        synced_at=connection.last_synced_at or datetime.now(UTC),
    )


@router.get("/databases/{database_id}/schema")
async def get_schema(
    connection: DatabaseDep, context: WorkspaceDep, session: SessionDep
) -> dict[str, Any]:
    context.require(Permission.VIEW_SCHEMA)
    tree = await SchemaService(session).schema_tree(connection.id)
    return {
        **tree,
        "database_id": str(connection.id),
        "last_synced_at": connection.last_synced_at.isoformat()
        if connection.last_synced_at
        else None,
        "schema_version": connection.schema_version,
    }


# --- business glossary ------------------------------------------------------


@router.get("/databases/{database_id}/glossary", response_model=list[GlossaryTermOut])
async def list_glossary(
    connection: DatabaseDep, context: WorkspaceDep, session: SessionDep
) -> list[GlossaryTermOut]:
    context.require(Permission.VIEW_SCHEMA)
    rows = (
        (
            await session.execute(
                select(GlossaryTerm)
                .where(GlossaryTerm.database_id == connection.id)
                .order_by(GlossaryTerm.term)
            )
        )
        .scalars()
        .all()
    )
    return [GlossaryTermOut.model_validate(r) for r in rows]


@router.post(
    "/databases/{database_id}/glossary",
    response_model=GlossaryTermOut,
    status_code=status.HTTP_201_CREATED,
)
async def upsert_glossary_term(
    payload: GlossaryTermIn,
    connection: DatabaseDep,
    context: WorkspaceDep,
    session: SessionDep,
) -> GlossaryTermOut:
    context.require(Permission.MANAGE_GLOSSARY)

    existing = (
        await session.execute(
            select(GlossaryTerm).where(
                GlossaryTerm.database_id == connection.id,
                GlossaryTerm.term == payload.term,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        existing.definition = payload.definition
        existing.maps_to = payload.maps_to
        await session.flush()
        return GlossaryTermOut.model_validate(existing)

    term = GlossaryTerm(
        database_id=connection.id,
        term=payload.term,
        definition=payload.definition,
        maps_to=payload.maps_to,
        created_by=context.user.id,
    )
    session.add(term)
    await session.flush()
    return GlossaryTermOut.model_validate(term)


@router.delete(
    "/databases/{database_id}/glossary/{term_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_glossary_term(
    term_id: uuid.UUID,
    connection: DatabaseDep,
    context: WorkspaceDep,
    session: SessionDep,
) -> None:
    context.require(Permission.MANAGE_GLOSSARY)
    term = (
        await session.execute(
            select(GlossaryTerm).where(
                GlossaryTerm.id == term_id, GlossaryTerm.database_id == connection.id
            )
        )
    ).scalar_one_or_none()
    if term is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "TERM_NOT_FOUND", "message": "Glossary term not found."},
        )
    await session.delete(term)
