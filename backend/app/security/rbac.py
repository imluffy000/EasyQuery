"""Role-based access control and tenant isolation.

Two rules hold everywhere in this codebase:

1. Authorization is decided server-side from the authenticated principal. A
   workspace_id or database_id arriving from the client is an *assertion*, not
   a grant -- `require_workspace_access` re-checks it against membership.
2. Permissions are explicit. A role that is not granted a permission does not
   have it; there is no implicit inheritance beyond the table below.
"""

from __future__ import annotations

from enum import StrEnum

from fastapi import HTTPException, status


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    ANALYST = "analyst"
    VIEWER = "viewer"


class Permission(StrEnum):
    # Workspace
    MANAGE_WORKSPACE = "manage_workspace"
    MANAGE_MEMBERS = "manage_members"
    VIEW_AUDIT_LOG = "view_audit_log"
    # Databases
    MANAGE_DATABASES = "manage_databases"
    SYNC_SCHEMA = "sync_schema"
    VIEW_SCHEMA = "view_schema"
    # Querying
    QUERY_DATABASE = "query_database"
    RUN_EXPENSIVE_QUERY = "run_expensive_query"
    SAVE_QUERY = "save_query"
    VIEW_RESULTS = "view_results"
    EXPORT_RESULTS = "export_results"
    # Glossary / settings
    MANAGE_GLOSSARY = "manage_glossary"
    VIEW_ANALYTICS = "view_analytics"


_VIEWER: frozenset[Permission] = frozenset(
    {
        Permission.VIEW_RESULTS,
        Permission.VIEW_SCHEMA,
    }
)

_ANALYST: frozenset[Permission] = _VIEWER | {
    Permission.QUERY_DATABASE,
    Permission.SAVE_QUERY,
    Permission.EXPORT_RESULTS,
    Permission.SYNC_SCHEMA,
    Permission.VIEW_ANALYTICS,
    # An analyst may override a cost warning; a viewer may not.
    Permission.RUN_EXPENSIVE_QUERY,
}

_ADMIN: frozenset[Permission] = _ANALYST | {
    Permission.MANAGE_DATABASES,
    Permission.MANAGE_MEMBERS,
    Permission.MANAGE_GLOSSARY,
    Permission.VIEW_AUDIT_LOG,
}

_OWNER: frozenset[Permission] = _ADMIN | {Permission.MANAGE_WORKSPACE}

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.VIEWER: _VIEWER,
    Role.ANALYST: _ANALYST,
    Role.ADMIN: _ADMIN,
    Role.OWNER: _OWNER,
}


def permissions_for(role: Role | str) -> frozenset[Permission]:
    try:
        return ROLE_PERMISSIONS[Role(role)]
    except (ValueError, KeyError):
        # Unknown role grants nothing rather than defaulting to something safe-looking.
        return frozenset()


def has_permission(role: Role | str, permission: Permission) -> bool:
    return permission in permissions_for(role)


def require_permission(role: Role | str, permission: Permission) -> None:
    """Raise 403 unless the role carries the permission."""
    if not has_permission(role, permission):
        action = permission.value.replace("_", " ")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "PERMISSION_DENIED",
                "message": f"Role '{role}' does not have permission to {action}.",
            },
        )
