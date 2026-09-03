"""Conversations, messages, clarifications, queries, and saved queries."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Timestamps, UUIDPrimaryKey


class Conversation(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_workspace_created", "workspace_id", "created_at"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    database_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("database_connections.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False, default="New conversation")

    # Rolling summary. Conversation context is carried as structured state plus
    # this summary rather than by replaying every prior message into the prompt
    # (spec section 74).
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Filters/entities established in earlier turns, so "only Hyderabad" and
    # "compare that with last year" resolve correctly.
    context_state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    messages: Mapped[list[Message]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_conversation_created", "conversation_id", "created_at"),)

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant | system
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    query_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("queries.id", ondelete="SET NULL"), nullable=True
    )
    # Clarification prompt / visualization spec / assumptions shown with the message.
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class Clarification(UUIDPrimaryKey, Timestamps, Base):
    """A question the assistant asked instead of guessing.

    Stored separately from messages so the clarification *rate* -- a headline
    quality metric in the analytics view -- is a cheap aggregate.
    """

    __tablename__ = "clarifications"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    dimension: Mapped[str | None] = mapped_column(String(40), nullable=True)
    options: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Query(UUIDPrimaryKey, Timestamps, Base):
    """One natural-language question and everything derived from it."""

    __tablename__ = "queries"
    __table_args__ = (
        Index("ix_queries_workspace_created", "workspace_id", "created_at"),
        Index("ix_queries_database_created", "database_id", "created_at"),
        Index("ix_queries_hash", "query_hash"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    database_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("database_connections.id", ondelete="SET NULL"),
        nullable=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True
    )

    question: Mapped[str] = mapped_column(Text, nullable=False)
    # Kept apart so the UI can show what was generated vs. what actually ran
    # after guard rewriting (spec section 4).
    generated_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    executed_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    query_plan: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    tables_used: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    assumptions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)

    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    row_count: Mapped[int | None] = mapped_column(nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(nullable=True)
    llm_latency_ms: Mapped[int | None] = mapped_column(nullable=True)
    input_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)

    retry_count: Mapped[int] = mapped_column(nullable=False, default=0)
    required_clarification: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    was_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    query_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    explain_plan: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    visualization: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)


class SavedQuery(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "saved_queries"
    __table_args__ = (Index("ix_saved_queries_workspace", "workspace_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    database_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("database_connections.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sql: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
    run_count: Mapped[int] = mapped_column(nullable=False, default=0)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
