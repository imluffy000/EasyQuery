"""Append-only audit trail.

Every action that touches a user database, changes access, or is refused by a
guard is recorded here. Audit writes are best-effort with respect to the
caller: a logging failure must never roll back or block the action being
audited, but it is escalated to the error log.
"""

from __future__ import annotations

import uuid
from enum import StrEnum
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog

log = structlog.get_logger(__name__)


class AuditEvent(StrEnum):
    # Access
    USER_LOGGED_IN = "user.logged_in"
    USER_LOGIN_FAILED = "user.login_failed"
    MEMBER_ADDED = "member.added"
    MEMBER_REMOVED = "member.removed"
    PERMISSIONS_CHANGED = "member.permissions_changed"
    # Databases
    DATABASE_CONNECTED = "database.connected"
    DATABASE_UPDATED = "database.updated"
    DATABASE_DISCONNECTED = "database.disconnected"
    DATABASE_TEST_FAILED = "database.test_failed"
    SCHEMA_SYNCED = "schema.synced"
    # Queries
    QUERY_GENERATED = "query.generated"
    QUERY_EXECUTED = "query.executed"
    QUERY_BLOCKED = "query.blocked"
    QUERY_FAILED = "query.failed"
    QUERY_TIMED_OUT = "query.timed_out"
    EXPENSIVE_QUERY_APPROVED = "query.expensive_approved"
    SAVED_QUERY_CREATED = "saved_query.created"
    RESULTS_EXPORTED = "results.exported"


# Keys that must never reach the audit table, even if a caller passes them.
_FORBIDDEN_METADATA_KEYS = frozenset(
    {"password", "passwd", "connection_string", "dsn", "api_key", "token", "secret", "credentials"}
)


def _scrub(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not metadata:
        return {}
    return {
        k: ("[redacted]" if k.lower() in _FORBIDDEN_METADATA_KEYS else v)
        for k, v in metadata.items()
    }


async def record(
    session: AsyncSession,
    *,
    event: AuditEvent,
    workspace_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    database_id: uuid.UUID | None = None,
    query_id: uuid.UUID | None = None,
    request_id: str | None = None,
    ip_address: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Write one audit row. Never raises."""
    try:
        session.add(
            AuditLog(
                event=event.value,
                workspace_id=workspace_id,
                user_id=user_id,
                database_id=database_id,
                query_id=query_id,
                request_id=request_id,
                ip_address=ip_address,
                event_metadata=_scrub(metadata),
            )
        )
        await session.flush()
    except Exception as exc:  # noqa: BLE001 - auditing must not break the request
        log.error("audit_write_failed", event=event.value, error=str(exc))
