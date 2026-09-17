"""record whether a capability acts on the outside world

Revision ID: 0007
Revises: 0006

The synthesizer placed human approval before every tool node, because nothing
told it which tools only read. A plan with twelve lookups and one send asked
for thirteen approvals. This column is that fact, so approval can sit before
the actions that change something outside Alter and nowhere else.

NOT NULL DEFAULT TRUE: every existing record, and every record registered
without saying, is treated as having side effects. A capability is excused
from approval only by an explicit false, never by being unlabelled.

A column rather than a key inside constraints JSONB: CapabilityConstraints
forbids unknown keys, so service code from before this revision would fail to
read any record that carried the new key. Old code ignores a column it does
not select, so a rollout or rollback can run both versions side by side.

Downgrade drops the column and with it every explicit false. After a
downgrade every capability is back to being approved before it runs, which is
the safe direction.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "ALTER TABLE capability_registry_versions "
            "ADD COLUMN side_effects BOOLEAN NOT NULL DEFAULT TRUE"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text("ALTER TABLE capability_registry_versions DROP COLUMN IF EXISTS side_effects")
    )
