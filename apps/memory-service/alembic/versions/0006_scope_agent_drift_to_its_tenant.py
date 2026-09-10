"""give drift_scores a tenant so agent drift can be read by its owner

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-10

`drift_scores` accepts three subject types -- 0001's own CHECK is
`subject_type IN ('agent','model','provider')` -- but its read policy admits
two:

    CREATE POLICY drift_read ON drift_scores FOR SELECT
      USING (subject_type IN ('model','provider'));

So agent drift computed, agent drift persisted, and agent drift returned zero
rows to the tenant that owned it. A default-deny RLS policy answers a
legitimate query with an empty result, and an empty result reads as "this agent
has never drifted" rather than as "you may not see this". The Drift Detector's
entire contribution to the healing loop is a score that changes the next
selection, and nothing could read one.

Why this is not a one-line policy change
----------------------------------------
The obvious fix -- add 'agent' to the IN list -- is a cross-tenant leak.
`drift_scores` has no tenant column at all: id, subject_type, subject_ref,
task_class, score, baseline, window, action_taken, created_at. Model and
provider drift are platform-wide facts and are safe to show every tenant, which
is exactly why 0001 could permit them unconditionally. Agent drift is
tenant-owned, and with no tenant on the row there is no predicate that could
scope it, which is what 0001's own docstring meant by deferring this.

So the column comes first, and the policy scopes on it -- the same shape
`memory_records` already uses two lines below the policy being replaced.

Existing rows
-------------
`tenant_id` is nullable because the agent rows already in the table were
written without one and cannot be attributed now. They stay unreadable, which
is exactly their behaviour today, so this migration takes nothing away. The
CHECK is added NOT VALID for the same reason: it constrains every future write
without failing on history it cannot fix.
"""

import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

_TENANT = "NULLIF(current_setting('app.current_tenant_id',true),'')::uuid"

_READ_AFTER = (
    "subject_type IN ('model','provider') "
    f"OR (subject_type='agent' AND tenant_id={_TENANT})"
)
_READ_BEFORE = "subject_type IN ('model','provider')"


def _replace_drift_read(using: str) -> str:
    return (
        "DROP POLICY IF EXISTS drift_read ON drift_scores; "
        f"CREATE POLICY drift_read ON drift_scores FOR SELECT USING ({using})"
    )


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE drift_scores ADD COLUMN tenant_id UUID"))
    op.execute(
        sa.text(
            "ALTER TABLE drift_scores ADD CONSTRAINT drift_scores_agent_tenant_check "
            "CHECK (subject_type <> 'agent' OR tenant_id IS NOT NULL) NOT VALID"
        )
    )
    # The existing index leads with subject_type, so a tenant-scoped agent read
    # cannot use it for the tenant predicate. This one is ordered for the query
    # list_agent_scores actually issues.
    op.execute(
        sa.text(
            "CREATE INDEX idx_drift_scores_tenant_agent ON drift_scores "
            "(tenant_id, subject_ref, created_at DESC) WHERE subject_type='agent'"
        )
    )
    op.execute(sa.text(_replace_drift_read(_READ_AFTER)))


def downgrade() -> None:
    # Order matters: the policy references the column, so it has to stop doing
    # that before the column can go.
    op.execute(sa.text(_replace_drift_read(_READ_BEFORE)))
    op.execute(sa.text("DROP INDEX IF EXISTS idx_drift_scores_tenant_agent"))
    op.execute(
        sa.text(
            "ALTER TABLE drift_scores "
            "DROP CONSTRAINT IF EXISTS drift_scores_agent_tenant_check"
        )
    )
    op.execute(sa.text("ALTER TABLE drift_scores DROP COLUMN tenant_id"))
