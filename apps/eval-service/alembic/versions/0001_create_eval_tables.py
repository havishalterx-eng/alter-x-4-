"""Create the service-owned eval_db foundation.

Eval records are internal quality and release artifacts, not tenant content.
Forced RLS therefore default-denies every role except eval_service carrying the
explicit app.eval_internal context. Later hardening tokens may add scoped input
to individual cases without weakening this database-level boundary.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
    op.execute(sa.text("""
CREATE TABLE golden_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT golden_sets_name_domain_version_unique UNIQUE (name, domain, version)
);
CREATE TABLE eval_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  golden_set_id UUID NOT NULL REFERENCES golden_sets(id) ON DELETE CASCADE,
  input JSONB NOT NULL,
  expected JSONB NOT NULL,
  scoring JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_eval_cases_golden_set ON eval_cases(golden_set_id);
CREATE TABLE eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  golden_set_id UUID NOT NULL REFERENCES golden_sets(id) ON DELETE RESTRICT,
  golden_set_version INTEGER NOT NULL CHECK (golden_set_version > 0),
  subject TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('pre_merge', 'promotion_gate', 'scheduled', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),
  pass_rate NUMERIC CHECK (pass_rate IS NULL OR pass_rate BETWEEN 0 AND 1),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eval_runs_completion_after_start CHECK (
    completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at)
  )
);
CREATE INDEX idx_eval_runs_golden_set_created ON eval_runs(golden_set_id, created_at DESC);
CREATE INDEX idx_eval_runs_status_created ON eval_runs(status, created_at DESC);
CREATE TABLE eval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_run_id UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  eval_case_id UUID NOT NULL REFERENCES eval_cases(id) ON DELETE RESTRICT,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
  score NUMERIC,
  output_ref TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eval_results_run_case_unique UNIQUE (eval_run_id, eval_case_id)
);
CREATE INDEX idx_eval_results_eval_case ON eval_results(eval_case_id);
CREATE TABLE redteam_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suite TEXT NOT NULL CHECK (suite IN ('injection', 'jailbreak', 'ssrf', 'upload', 'tenant_leak')),
  target TEXT NOT NULL,
  attack_ref TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('blocked', 'detected', 'bypassed')),
  severity TEXT CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high', 'critical')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_redteam_results_suite_created ON redteam_results(suite, created_at DESC);
CREATE TABLE release_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  eval_run_id UUID REFERENCES eval_runs(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'blocked')),
  decided_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_release_gates_subject_created ON release_gates(subject, created_at DESC);
CREATE INDEX idx_release_gates_eval_run ON release_gates(eval_run_id);
"""))
    for table in (
        "golden_sets",
        "eval_cases",
        "eval_runs",
        "eval_results",
        "redteam_results",
        "release_gates",
    ):
        op.execute(sa.text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        op.execute(sa.text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
        op.execute(
            sa.text(
                f"""
CREATE POLICY {table}_internal_access ON {table}
FOR ALL
USING (current_user = 'eval_service' AND current_setting('app.eval_internal', true) = 'on')
WITH CHECK (current_user = 'eval_service' AND current_setting('app.eval_internal', true) = 'on')
"""
            )
        )


def downgrade() -> None:
    for table in (
        "release_gates",
        "redteam_results",
        "eval_results",
        "eval_runs",
        "eval_cases",
        "golden_sets",
    ):
        op.execute(sa.text(f"DROP TABLE IF EXISTS {table}"))
