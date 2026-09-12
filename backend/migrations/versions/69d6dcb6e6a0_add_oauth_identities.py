"""add OAuth identity mappings

Revision ID: 69d6dcb6e6a0
Revises: c4468d16bf57
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "69d6dcb6e6a0"
down_revision: str | None = "c4468d16bf57"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "oauth_identities",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_subject", name="oauth_provider_subject"),
        sa.UniqueConstraint("user_id", "provider", name="oauth_user_provider"),
    )


def downgrade() -> None:
    op.drop_table("oauth_identities")
