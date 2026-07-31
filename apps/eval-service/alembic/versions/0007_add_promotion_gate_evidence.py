"""Make Phase 9 promotion decisions append-only and evidence-backed."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("""
ALTER TABLE release_gates
  ADD COLUMN candidate TEXT,
  ADD COLUMN environment TEXT,
  ADD COLUMN evidence JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION prevent_release_gate_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'release_gates are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER release_gates_append_only
  BEFORE UPDATE OR DELETE ON release_gates
  FOR EACH ROW EXECUTE FUNCTION prevent_release_gate_mutation();
"""))


def downgrade() -> None:
    op.execute(sa.text("""
DROP TRIGGER IF EXISTS release_gates_append_only ON release_gates;
DROP FUNCTION IF EXISTS prevent_release_gate_mutation();
ALTER TABLE release_gates
  DROP COLUMN IF EXISTS evidence,
  DROP COLUMN IF EXISTS environment,
  DROP COLUMN IF EXISTS candidate;
"""))
