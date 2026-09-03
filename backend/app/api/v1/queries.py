"""Query history, details, SQL validation, and saved queries."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query as QueryParam, status
from sqlalchemy import select

from app.api.deps import SessionDep, SettingsDep, WorkspaceDep
from app.models.conversation import Query, SavedQuery
from app.models.database_connection import DatabaseConnection
from app.schemas.api import (
    QueryDetailOut,
    QueryOut,
    SavedQueryCreate,
    SavedQueryOut,
    ValidateSQLRequest,
    ValidateSQLResponse,
)
from app.security.rbac import Permission
from app.security.sql_guard import build_guard

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["queries"])


@router.get("/history", response_model=list[QueryOut])
async def query_history(
    context: WorkspaceDep,
    session: SessionDep,
    search: Annotated[str | None, QueryParam(max_length=200)] = None,
    status_filter: Annotated[str | None, QueryParam(alias="status")] = None,
    database_id: uuid.UUID | None = None,
    limit: Annotated[int, QueryParam(ge=1, le=200)] = 50,
    offset: Annotated[int, QueryParam(ge=0)] = 0,
) -> list[QueryOut]:
    context.require(Permission.VIEW_RESULTS)

    stmt = select(Query).where(Query.workspace_id == context.workspace.id)
    if search:
        stmt = stmt.where(Query.question.ilike(f"%{search}%"))
    if status_filter:
        stmt = stmt.where(Query.status == status_filter)
    if database_id:
        stmt = stmt.where(Query.database_id == database_id)

    rows = (
        await session.execute(
            stmt.order_by(Query.created_at.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    return [QueryOut.model_validate(r) for r in rows]


@router.get("/queries/{query_id}", response_model=QueryDetailOut)
async def query_detail(
    query_id: uuid.UUID, context: WorkspaceDep, session: SessionDep
) -> QueryDetailOut:
    context.require(Permission.VIEW_RESULTS)
    record = (
        await session.execute(
            select(Query).where(
                Query.id == query_id, Query.workspace_id == context.workspace.id
            )
        )
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "QUERY_NOT_FOUND", "message": "Query not found."},
        )
    return QueryDetailOut.model_validate(record)


@router.post("/queries/validate", response_model=ValidateSQLResponse)
async def validate_sql(
    payload: ValidateSQLRequest,
    context: WorkspaceDep,
    session: SessionDep,
    settings: SettingsDep,
) -> ValidateSQLResponse:
    """Validate SQL without executing it.

    Used by the SQL editor so a user sees exactly what the guard would do --
    including the LIMIT it would inject -- before running anything.
    """
    context.require(Permission.QUERY_DATABASE)

    connection = (
        await session.execute(
            select(DatabaseConnection).where(
                DatabaseConnection.id == payload.database_id,
                DatabaseConnection.workspace_id == context.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DATABASE_NOT_FOUND", "message": "Database connection not found."},
        )

    guard = build_guard(
        allowed_schemas=list(connection.allowed_schemas),
        max_rows=min(connection.max_rows, settings.query.max_rows),
        max_joins=settings.query.max_joins,
        read_only=connection.read_only,
    )
    result = guard.validate(payload.sql)
    return ValidateSQLResponse(
        ok=result.ok,
        safe_sql=result.safe_sql,
        errors=[{"code": e.code.value, "message": e.message} for e in result.errors],
        warnings=result.warnings,
        tables=result.tables,
        join_count=result.join_count,
    )


# --- saved queries ----------------------------------------------------------


@router.get("/saved-queries", response_model=list[SavedQueryOut])
async def list_saved(context: WorkspaceDep, session: SessionDep) -> list[SavedQueryOut]:
    context.require(Permission.VIEW_RESULTS)
    rows = (
        await session.execute(
            select(SavedQuery)
            .where(SavedQuery.workspace_id == context.workspace.id)
            .order_by(SavedQuery.created_at.desc())
        )
    ).scalars().all()
    return [SavedQueryOut.model_validate(r) for r in rows]


@router.post(
    "/saved-queries", response_model=SavedQueryOut, status_code=status.HTTP_201_CREATED
)
async def create_saved(
    payload: SavedQueryCreate,
    context: WorkspaceDep,
    session: SessionDep,
    settings: SettingsDep,
) -> SavedQueryOut:
    context.require(Permission.SAVE_QUERY)

    # A saved query is executable later, so it passes the guard now rather
    # than becoming a stored way to run something that would be blocked.
    guard = build_guard(max_rows=settings.query.max_rows, max_joins=settings.query.max_joins)
    verdict = guard.validate(payload.sql)
    if not verdict.ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": verdict.errors[0].code.value,
                "message": verdict.errors[0].message,
            },
        )

    saved = SavedQuery(
        workspace_id=context.workspace.id,
        database_id=payload.database_id,
        created_by=context.user.id,
        name=payload.name,
        description=payload.description,
        sql=payload.sql,
        tags=payload.tags,
    )
    session.add(saved)
    await session.flush()
    return SavedQueryOut.model_validate(saved)


@router.delete("/saved-queries/{saved_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved(
    saved_id: uuid.UUID, context: WorkspaceDep, session: SessionDep
) -> None:
    context.require(Permission.SAVE_QUERY)
    saved = (
        await session.execute(
            select(SavedQuery).where(
                SavedQuery.id == saved_id,
                SavedQuery.workspace_id == context.workspace.id,
            )
        )
    ).scalar_one_or_none()
    if saved is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "SAVED_QUERY_NOT_FOUND", "message": "Saved query not found."},
        )
    await session.delete(saved)
