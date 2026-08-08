"""Create the read-only cross-tenant drift discovery role."""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'intelligence_drift_reader') THEN
    CREATE ROLE intelligence_drift_reader LOGIN BYPASSRLS;
  END IF;
END $$;
GRANT SELECT ON performance_records TO intelligence_drift_reader;
GRANT USAGE ON SCHEMA public TO intelligence_drift_reader;
"""))


def downgrade() -> None:
    op.execute(sa.text("REVOKE ALL ON performance_records FROM intelligence_drift_reader"))
