"""Audit log and usage metrics."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import Date, Float, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, UUIDPrimaryKey


class AuditLog(UUIDPrimaryKey, Timestamps, Base):
    """Append-only record of security-relevant actions.

    There is no update path and no delete path in the application; rows are
    written once. Retention is handled outside the app.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_workspace_created", "workspace_id", "created_at"),
        Index("ix_audit_logs_event", "event"),
    )

    event: Mapped[str] = mapped_column(String(60), nullable=False)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    database_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("database_connections.id", ondelete="SET NULL"),
        nullable=True,
    )
    query_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("queries.id", ondelete="SET NULL"), nullable=True
    )
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(INET, nullable=True)
    # Scrubbed in app.security.audit before it ever reaches here.
    event_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class UsageMetric(UUIDPrimaryKey, Timestamps, Base):
    """Daily per-workspace rollup backing the analytics dashboard."""

    __tablename__ = "usage_metrics"
    __table_args__ = (Index("ix_usage_metrics_workspace_day", "workspace_id", "day", unique=True),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)

    query_count: Mapped[int] = mapped_column(nullable=False, default=0)
    success_count: Mapped[int] = mapped_column(nullable=False, default=0)
    failure_count: Mapped[int] = mapped_column(nullable=False, default=0)
    blocked_count: Mapped[int] = mapped_column(nullable=False, default=0)
    timeout_count: Mapped[int] = mapped_column(nullable=False, default=0)
    clarification_count: Mapped[int] = mapped_column(nullable=False, default=0)
    correction_count: Mapped[int] = mapped_column(nullable=False, default=0)
    input_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
