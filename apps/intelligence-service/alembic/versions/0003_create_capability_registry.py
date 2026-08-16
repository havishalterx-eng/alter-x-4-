"""create governed capability registry

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("""
CREATE TABLE capability_registry_versions (
  capability_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  owner_tenant_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'tenant', 'workspace')),
  workspace_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('agent', 'model', 'tool', 'connector', 'execution')),
  supported_capabilities JSONB NOT NULL,
  constraints JSONB NOT NULL,
  availability JSONB NOT NULL,
  provenance JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('active', 'deprecated', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_tenant_id, capability_id, version),
  CHECK ((scope = 'workspace') = (workspace_id IS NOT NULL))
)
"""))
    op.execute(sa.text("ALTER TABLE capability_registry_versions ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE capability_registry_versions FORCE ROW LEVEL SECURITY"))
    op.execute(sa.text("""
CREATE POLICY capability_registry_visibility ON capability_registry_versions
USING (
  owner_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  OR scope = 'global'
)
WITH CHECK (owner_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
"""))
    op.execute(
        sa.text(
            "CREATE INDEX idx_capability_registry_search "
            "ON capability_registry_versions "
            "(owner_tenant_id, kind, status, capability_id, version DESC)"
        )
    )
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX idx_capability_registry_one_active_version "
            "ON capability_registry_versions (owner_tenant_id, capability_id) "
            "WHERE status = 'active'"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS capability_registry_versions"))
