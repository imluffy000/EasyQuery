"""Users, organizations, workspaces, and membership.

Tenancy chain: User -> Organization -> Workspace -> DatabaseConnection.
Every tenant-owned row below carries `workspace_id`, and every query that
reads one filters on a workspace the caller is a verified member of.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Timestamps, UUIDPrimaryKey

if TYPE_CHECKING:
    from app.models.database_connection import DatabaseConnection


class User(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    # Never a plaintext password. bcrypt via passlib.
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    memberships: Mapped[list[OrganizationMember]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    oauth_identities: Mapped[list[OAuthIdentity]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class OAuthIdentity(UUIDPrimaryKey, Timestamps, Base):
    """Provider subject mapping; secrets/tokens are deliberately not stored."""

    __tablename__ = "oauth_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject", name="oauth_provider_subject"),
        UniqueConstraint("user_id", "provider", name="oauth_user_provider"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    user: Mapped[User] = relationship(back_populates="oauth_identities")


class Organization(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)

    members: Mapped[list[OrganizationMember]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )
    workspaces: Mapped[list[Workspace]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )


class OrganizationMember(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "organization_members"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="organization_id_user_id"),
        Index("ix_org_members_user", "user_id"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="analyst")

    organization: Mapped[Organization] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")


class Workspace(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "workspaces"
    __table_args__ = (UniqueConstraint("organization_id", "slug", name="organization_id_slug"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)

    # Workspace-level guardrails. These may tighten the global ceiling from
    # settings, never loosen it -- the service layer takes the minimum.
    max_rows: Mapped[int] = mapped_column(nullable=False, default=10_000)
    query_timeout_seconds: Mapped[int] = mapped_column(nullable=False, default=30)
    rate_limit_per_minute: Mapped[int] = mapped_column(nullable=False, default=30)

    organization: Mapped[Organization] = relationship(back_populates="workspaces")
    members: Mapped[list[WorkspaceMember]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )
    databases: Mapped[list[DatabaseConnection]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan"
    )


class WorkspaceMember(UUIDPrimaryKey, Timestamps, Base):
    """Per-workspace role. This is the row `require_workspace_access` checks."""

    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="workspace_id_user_id"),
        Index("ix_workspace_members_user", "user_id"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="analyst")

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship()
