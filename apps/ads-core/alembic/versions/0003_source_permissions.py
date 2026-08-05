"""Add source-level permissions (including retention policy) to sources.

Document-level permissions already live on documents.permissions (0001).
Source-level permissions use the same JSONB-column shape so both levels are
read, written, and validated by the same typed models -- plus a
`retention_days` field that the deletion service's retention sweep actually
enforces against that source's documents.
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0003_source_permissions"
down_revision = "0002_retrieval_safety_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sources", sa.Column("permissions", JSONB()))
    op.execute(
        sa.text(
            "CREATE INDEX sources_retention_days_idx ON sources "
            "((permissions->>'retention_days')) "
            "WHERE jsonb_typeof(permissions->'retention_days') = 'number'"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS sources_retention_days_idx"))
    op.drop_column("sources", "permissions")
