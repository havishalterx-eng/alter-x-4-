# ruff: noqa: E501
"""prune dead policy kinds, seed default quality_thresholds

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-19

provider_policy, model_alias_map, and trigger_limits were declared in the
PolicyKind CHECK constraint since 0001 with zero real consumers anywhere in
the monorepo -- confirmed by a full-repo grep, not just this service. No
row has ever used any of the three (no seed, no real write path). Narrowing
the constraint removes them from the writable set going forward.

quality_thresholds keeps its slot -- verification-service's own kernel.py
comment names this exact policy kind as "a later Self-Healing-phase
ticket" for per-tenant threshold tuning. That ticket is this migration:
seeds one default global row (same shape as 0002's recovery_preferences
seed) so update-policy has something to patch per-tenant, and
verification-service's kernel now reads it for real instead of only ever
using its hardcoded DEFAULT_THRESHOLD/WARN_MARGIN constants.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE policies DROP CONSTRAINT policies_kind_check"))
    op.execute(
        sa.text(
            "ALTER TABLE policies ADD CONSTRAINT policies_kind_check "
            "CHECK (kind IN ('routing_weights','quality_thresholds','recovery_preferences'))"
        )
    )
    op.execute(sa.text("ALTER TABLE policies NO FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text(
            """
INSERT INTO policies (id, scope, scope_id, kind, version, body, status, source)
VALUES (
  'pol_00000000-0000-7000-8000-000000000002',
  'global',
  NULL,
  'quality_thresholds',
  1,
  '{
    "threshold": 0.7,
    "warn_margin": 0.15
  }'::jsonb,
  'active',
  'human'
)
"""
        )
    )
    op.execute(sa.text("ALTER TABLE policies FORCE ROW LEVEL SECURITY"))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE policies NO FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text(
            "DELETE FROM policies WHERE id = 'pol_00000000-0000-7000-8000-000000000002'"
        )
    )
    op.execute(sa.text("ALTER TABLE policies FORCE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE policies DROP CONSTRAINT policies_kind_check"))
    op.execute(
        sa.text(
            "ALTER TABLE policies ADD CONSTRAINT policies_kind_check "
            "CHECK (kind IN ('routing_weights','quality_thresholds','recovery_preferences','provider_policy','model_alias_map','trigger_limits'))"
        )
    )
