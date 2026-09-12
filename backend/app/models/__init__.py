"""SQLAlchemy models.

Imported as a package so Alembic autogenerate sees every table.
"""

from app.models.audit import AuditLog, UsageMetric
from app.models.base import Base
from app.models.conversation import (
    Clarification,
    Conversation,
    Message,
    Query,
    SavedQuery,
)
from app.models.database_connection import (
    DatabaseConnection,
    DatabaseTable,
    GlossaryTerm,
)
from app.models.tenancy import (
    Organization,
    OrganizationMember,
    OAuthIdentity,
    User,
    Workspace,
    WorkspaceMember,
)

__all__ = [
    "AuditLog",
    "Base",
    "Clarification",
    "Conversation",
    "DatabaseConnection",
    "DatabaseTable",
    "GlossaryTerm",
    "Message",
    "Organization",
    "OrganizationMember",
    "OAuthIdentity",
    "Query",
    "SavedQuery",
    "UsageMetric",
    "User",
    "Workspace",
    "WorkspaceMember",
]
