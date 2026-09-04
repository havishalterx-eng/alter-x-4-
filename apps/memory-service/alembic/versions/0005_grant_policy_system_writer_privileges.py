"""grant the policy_system_writer identity the privileges its own code needs

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-04

0001 wrote RLS policies that key on `current_user='policy_system_writer'` and
the service opens a second engine as that role (`policy_db_system_url_sync`),
but nothing ever granted the role table privileges. It could connect and
nothing else: every system-session statement failed with "permission denied
for table ...". The service's own integration tests never caught it because
each one creates the role and grants it explicitly in setup.

That made three real paths dead on any cluster provisioned the normal way --
`infrastructure/local/engine-db-init.sh` grants CONNECT only:
  - drift_scores: EVERY drift write goes through the system session
    (SqlAlchemyDriftRepository.record_agent_score / record_outcome_score),
    not just global-scope ones, so the Drift Detector wrote nothing at all.
  - policies / policy_promotions: global-scope policy updates and promotions.
  - memory_records: global-scope memory promotion and revocation.

Granting from the owning service's migration mirrors intelligence-service's
0002, which grants its own second role (intelligence_drift_reader) the same
way: the migration runs as the table owner and is the one place that applies
on every cluster, local or deployed.

Unlike that migration this one does not create the role when it is absent.
Creating a LOGIN role here would mean creating a passwordless one, and the
role is a cluster-level object that provisioning already owns
(engine-db-init.sh, or the deployed equivalent). A cluster without the role
gets no grants and no error, and picks them up on the next run once
provisioning has created it.

No DELETE: nothing in the service deletes from any of these tables.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("policies", "policy_promotions", "memory_records", "drift_scores")
_ROLE = "policy_system_writer"


def _when_role_exists(statements: Sequence[str]) -> str:
    body = "\n".join(f"    EXECUTE '{statement}';" for statement in statements)
    return f"""
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{_ROLE}') THEN
{body}
  END IF;
END $$;
"""


def upgrade() -> None:
    op.execute(
        sa.text(
            _when_role_exists(
                [f"GRANT USAGE ON SCHEMA public TO {_ROLE}"]
                + [
                    f"GRANT SELECT, INSERT, UPDATE ON {table} TO {_ROLE}"
                    for table in _TABLES
                ]
            )
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            _when_role_exists(
                [f"REVOKE ALL ON {table} FROM {_ROLE}" for table in _TABLES]
                + [f"REVOKE USAGE ON SCHEMA public FROM {_ROLE}"]
            )
        )
    )
