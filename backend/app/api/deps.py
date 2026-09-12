"""Shared FastAPI dependencies.

`require_workspace_access` is the tenant-isolation choke point: a workspace_id
from the client is never trusted, it is re-resolved against WorkspaceMember for
the authenticated user on every request.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.llm import LLMProvider
from app.config.settings import Settings, get_settings
from app.database.connectors.base import DatabaseConnector
from app.database.manager import ConnectionManager
from app.database.session import get_session
from app.models.database_connection import DatabaseConnection
from app.models.tenancy import User, Workspace, WorkspaceMember
from app.security.auth import decode_token
from app.security.rbac import Permission, Role, require_permission

_bearer = HTTPBearer(auto_error=False)

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _unauthorized(message: str = "Not authenticated.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "UNAUTHENTICATED", "message": message},
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    session: SessionDep,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
) -> User:
    if credentials is None or not credentials.credentials:
        raise _unauthorized()

    payload = decode_token(settings=settings, token=credentials.credentials)
    if payload is None:
        raise _unauthorized("Token is invalid or has expired.")

    user = (
        await session.execute(select(User).where(User.id == payload.user_id))
    ).scalar_one_or_none()

    if user is None or not user.is_active:
        raise _unauthorized("Account is unavailable.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_superuser(user: CurrentUser) -> User:
    """Global operations endpoints are never granted by workspace roles."""
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "SUPERUSER_REQUIRED", "message": "Administrator access is required."},
        )
    return user


Superuser = Annotated[User, Depends(require_superuser)]


@dataclass
class WorkspaceContext:
    """An authenticated user's verified access to one workspace."""

    workspace: Workspace
    user: User
    role: Role

    def require(self, permission: Permission) -> None:
        require_permission(self.role, permission)


async def require_workspace_access(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> WorkspaceContext:
    """Resolve membership. A non-member gets 404, not 403.

    Returning 404 keeps workspace existence from leaking to outsiders; a
    genuine member who lacks a *permission* still gets a clear 403 later.
    """
    row = (
        await session.execute(
            select(Workspace, WorkspaceMember)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(
                Workspace.id == workspace_id,
                WorkspaceMember.user_id == user.id,
            )
        )
    ).first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "WORKSPACE_NOT_FOUND", "message": "Workspace not found."},
        )

    workspace, membership = row
    return WorkspaceContext(workspace=workspace, user=user, role=Role(membership.role))


WorkspaceDep = Annotated[WorkspaceContext, Depends(require_workspace_access)]


async def get_database_connection(
    database_id: uuid.UUID,
    session: SessionDep,
    context: WorkspaceDep,
) -> DatabaseConnection:
    """Load a connection, scoped to the caller's workspace."""
    connection = (
        await session.execute(
            select(DatabaseConnection).where(
                DatabaseConnection.id == database_id,
                # Scoping by workspace is what stops a valid id from another
                # tenant being readable.
                DatabaseConnection.workspace_id == context.workspace.id,
            )
        )
    ).scalar_one_or_none()

    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DATABASE_NOT_FOUND", "message": "Database connection not found."},
        )
    return connection


DatabaseDep = Annotated[DatabaseConnection, Depends(get_database_connection)]


def get_connection_manager(request: Request) -> ConnectionManager:
    manager = getattr(request.app.state, "connection_manager", None)
    if manager is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "NOT_READY", "message": "Connection manager is not available."},
        )
    return manager


def get_llm(request: Request) -> LLMProvider:
    provider = getattr(request.app.state, "llm", None)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "NOT_READY", "message": "Model provider is not available."},
        )
    return provider


ManagerDep = Annotated[ConnectionManager, Depends(get_connection_manager)]
LLMDep = Annotated[LLMProvider, Depends(get_llm)]


async def get_connector(
    connection: DatabaseDep,
    manager: ManagerDep,
) -> DatabaseConnector:
    return await manager.get(connection)


ConnectorDep = Annotated[DatabaseConnector, Depends(get_connector)]
