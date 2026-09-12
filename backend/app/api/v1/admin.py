"""Global operations endpoints, isolated from workspace administration."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import func, select

from app.api.deps import SessionDep, Superuser
from app.models.database_connection import DatabaseConnection
from app.models.tenancy import User, Workspace, WorkspaceMember
from app.schemas.api import AdminOverviewOut, AdminUserOut

router = APIRouter(prefix="/admin", tags=["administration"])


@router.get("/overview", response_model=AdminOverviewOut)
async def overview(_admin: Superuser, session: SessionDep) -> AdminOverviewOut:
    """Return operational metadata only; credentials and query content stay private."""
    workspace_count = (
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.user_id == User.id)
        .correlate(User)
        .scalar_subquery()
    )
    rows = (
        await session.execute(
            select(User, workspace_count.label("workspace_count"))
            .order_by(User.created_at.desc())
            .limit(500)
        )
    ).all()
    users = [
        AdminUserOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            created_at=user.created_at,
            workspace_count=count,
        )
        for user, count in rows
    ]
    total_users, active_users, total_workspaces, total_connections = (
        await session.execute(
            select(
                func.count(User.id),
                func.count(User.id).filter(User.is_active.is_(True)),
                select(func.count(Workspace.id)).scalar_subquery(),
                select(func.count(DatabaseConnection.id)).scalar_subquery(),
            )
        )
    ).one()
    return AdminOverviewOut(
        users=users,
        total_users=total_users,
        active_users=active_users,
        total_workspaces=total_workspaces,
        total_connections=total_connections,
    )
