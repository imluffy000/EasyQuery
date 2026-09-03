"""Registration, login, refresh, and identity."""

from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep, SettingsDep
from app.models.tenancy import (
    Organization,
    OrganizationMember,
    User,
    Workspace,
    WorkspaceMember,
)
from app.schemas.api import (
    LoginRequest,
    MembershipOut,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
    WorkspaceOut,
)
from app.security import audit
from app.security.audit import AuditEvent
from app.security.auth import create_token, decode_token, hash_password, verify_password
from app.security.rbac import Role, permissions_for

router = APIRouter(prefix="/auth", tags=["auth"])


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (slug or "workspace")[:80]


def _issue(settings: SettingsDep, user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(
            settings=settings, user_id=user.id, email=user.email, token_type="access"
        ),
        refresh_token=create_token(
            settings=settings, user_id=user.id, email=user.email, token_type="refresh"
        ),
        expires_in=settings.access_token_ttl_minutes * 60,
    )


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest, session: SessionDep, settings: SettingsDep
) -> TokenPair:
    existing = (
        await session.execute(select(User).where(User.email == payload.email.lower()))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "EMAIL_TAKEN", "message": "An account with this email exists."},
        )

    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
    )
    session.add(user)
    await session.flush()

    # A new account gets an organization and a default workspace, so the first
    # database connection has somewhere to live.
    org_slug = f"{_slugify(payload.organization_name)}-{uuid.uuid4().hex[:6]}"
    organization = Organization(name=payload.organization_name, slug=org_slug)
    session.add(organization)
    await session.flush()

    session.add(
        OrganizationMember(organization_id=organization.id, user_id=user.id, role=Role.OWNER.value)
    )
    workspace = Workspace(organization_id=organization.id, name="Default", slug="default")
    session.add(workspace)
    await session.flush()
    session.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=Role.OWNER.value))

    await audit.record(
        session, event=AuditEvent.USER_LOGGED_IN, user_id=user.id, workspace_id=workspace.id
    )
    return _issue(settings, user)


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest, request: Request, session: SessionDep, settings: SettingsDep
) -> TokenPair:
    user = (
        await session.execute(select(User).where(User.email == payload.email.lower()))
    ).scalar_one_or_none()

    # Same error and roughly the same work whether the account exists or not,
    # so the response does not reveal which emails are registered.
    if user is None or not verify_password(payload.password, user.hashed_password):
        if user is not None:
            await audit.record(
                session,
                event=AuditEvent.USER_LOGIN_FAILED,
                user_id=user.id,
                ip_address=request.client.host if request.client else None,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_CREDENTIALS", "message": "Incorrect email or password."},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "ACCOUNT_DISABLED", "message": "This account is disabled."},
        )

    await audit.record(
        session,
        event=AuditEvent.USER_LOGGED_IN,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
    )
    return _issue(settings, user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: SessionDep, settings: SettingsDep) -> TokenPair:
    claims = decode_token(settings=settings, token=payload.refresh_token, expected_type="refresh")
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Refresh token is invalid or expired."},
        )

    user = (
        await session.execute(select(User).where(User.id == claims.user_id))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN", "message": "Refresh token is invalid or expired."},
        )
    return _issue(settings, user)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.get("/memberships", response_model=list[MembershipOut])
async def memberships(user: CurrentUser, session: SessionDep) -> list[MembershipOut]:
    rows = (
        await session.execute(
            select(Workspace, WorkspaceMember)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .where(WorkspaceMember.user_id == user.id)
            .order_by(Workspace.created_at)
        )
    ).all()

    return [
        MembershipOut(
            workspace=WorkspaceOut.model_validate(workspace),
            role=membership.role,
            permissions=sorted(p.value for p in permissions_for(membership.role)),
        )
        for workspace, membership in rows
    ]
