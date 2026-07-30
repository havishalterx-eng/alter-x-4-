"""Add complete ADS Q retrieval audit details."""

import sqlalchemy as sa

from alembic import op

revision = "0002_retrieval_safety_audit"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE retrieval_audit ALTER COLUMN scope_id DROP NOT NULL"))
    for name, default in (
        ("scope_inputs", "'{}'::jsonb"),
        ("filters", "'{}'::jsonb"),
        ("candidate_ids", "'[]'::jsonb"),
        ("ranking_summary", "'{}'::jsonb"),
    ):
        op.add_column(
            "retrieval_audit",
            sa.Column(name, sa.JSON(), nullable=False, server_default=sa.text(default)),
        )
    op.add_column(
        "retrieval_audit",
        sa.Column("outcome", sa.Text(), nullable=False, server_default="succeeded"),
    )
    op.add_column("retrieval_audit", sa.Column("failure_reason", sa.Text()))
    op.add_column("retrieval_audit", sa.Column("completed_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    for column in (
        "completed_at",
        "failure_reason",
        "outcome",
        "ranking_summary",
        "candidate_ids",
        "filters",
        "scope_inputs",
    ):
        op.drop_column("retrieval_audit", column)
    op.execute(sa.text("ALTER TABLE retrieval_audit ALTER COLUMN scope_id SET NOT NULL"))
