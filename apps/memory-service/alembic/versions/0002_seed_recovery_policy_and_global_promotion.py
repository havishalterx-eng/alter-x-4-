# ruff: noqa: E501
"""seed HEAL-6 recovery policy and permit irreversible global anonymization

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-30

The policy schema deliberately uses an integer row version. HEAL-6's external
semantic version is therefore stored as body.policy_version while version=1
remains the optimistic-concurrency value used by MemoryService.UpdatePolicy.

The original tenant immutability trigger made the schema's documented global
promotion (tenant UUID -> NULL) impossible. This revision permits exactly that
one-way transition, only for a global row promoted by policy_system_writer.
Every other tenant mutation remains rejected.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RECOVERY_POLICY_ID = "pol_00000000-0000-7000-8000-000000000001"


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE policies NO FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text(
            """
INSERT INTO policies (id, scope, scope_id, kind, version, body, status, source)
VALUES (
  'pol_00000000-0000-7000-8000-000000000001',
  'global',
  NULL,
  'recovery_preferences',
  1,
  '{
    "policy_version": "heal6-deterministic-v1",
    "rules": {
      "safety_violation": "ask_user",
      "tool_permission_denial": "ask_user",
      "rate_limit": "backoff",
      "timeout": ["retry", "swap_agent"],
      "infrastructure_failure": ["retry", "swap_agent"],
      "sandbox_crash": ["retry", "recompile"],
      "logic_output_failure": ["escalate_model", "replan"],
      "unknown": "ask_user"
    }
  }'::jsonb,
  'active',
  'human'
)
"""
        )
    )
    op.execute(sa.text("ALTER TABLE policies FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text(
            """
CREATE OR REPLACE FUNCTION reject_tenant_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND NOT (
       TG_TABLE_NAME = 'memory_records'
       AND OLD.tenant_id IS NOT NULL
       AND NEW.tenant_id IS NULL
       AND OLD.scope = 'global'
       AND NEW.scope = 'global'
       AND NEW.status = 'promoted'
       AND current_user = 'policy_system_writer'
     ) THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$function$
"""
        )
    )


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE policies NO FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text(
            "DELETE FROM policies WHERE id = 'pol_00000000-0000-7000-8000-000000000001'"
        )
    )
    op.execute(sa.text("ALTER TABLE policies FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text(
            """
CREATE OR REPLACE FUNCTION reject_tenant_id_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  RETURN NEW;
END;
$function$
"""
        )
    )
