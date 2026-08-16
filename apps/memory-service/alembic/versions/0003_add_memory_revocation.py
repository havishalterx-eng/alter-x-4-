"""add reverted_at to memory_records for real promoted -> reverted revocation

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-17

memory_records.status already declared 'reverted' as a valid CHECK value
(migration 0001) but no code path ever set it -- a promoted memory could
never actually be reverted. This adds the timestamp column the revocation
transition needs for the same idempotency pattern promoted_at already
uses (a second revert call returns the existing reverted_at rather than
erroring). No tenant_id/RLS/trigger change needed: revocation never
mutates tenant_id, so the existing reject_tenant_id_change() promotion
carve-out is untouched.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text("ALTER TABLE memory_records ADD COLUMN reverted_at TIMESTAMPTZ")
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE memory_records DROP COLUMN reverted_at"))
