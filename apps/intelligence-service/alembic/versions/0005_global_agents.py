"""support global (platform-wide) agents via a real sentinel tenant

Revision ID: 0005
Revises: 0004

True-NULL tenant_id was considered and rejected: agent_versions,
capability_embeddings, and performance_records all FK-join to agents on
(tenant_id, agent_id) with tenant_id NOT NULL on the child side --
composite-FK matching can never satisfy a NULL parent, so a global agent
built that way could never get a version, embedding, or performance
record, and the ranked-match join (ce.tenant_id = a.tenant_id) can never
be true against NULL either. Global entries here instead use the exact
same real sentinel pattern capability_registry_versions already
established in this service (PLATFORM_TENANT_ID, see src/db/ids.py) --
a real, joinable UUID, not NULL, so every existing FK/join keeps working
unchanged. workspace_id has no such FK fragility (nothing joins on it),
so it is genuinely nullable instead: a global agent has no workspace.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PLATFORM_TENANT_ID = "00000000-0000-7000-8000-000000000001"


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE agents ALTER COLUMN workspace_id DROP NOT NULL"))
    op.execute(
        sa.text(
            f"""
ALTER TABLE agents
  ADD CONSTRAINT agents_global_workspace_check
  CHECK ((tenant_id = '{_PLATFORM_TENANT_ID}'::uuid) = (workspace_id IS NULL))
"""
        )
    )

    op.execute(sa.text("DROP POLICY agents_tenant_context_isolation ON agents"))
    op.execute(
        sa.text(
            f"""
CREATE POLICY agents_tenant_context_isolation ON agents
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  OR tenant_id = '{_PLATFORM_TENANT_ID}'::uuid
)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
"""
        )
    )

    op.execute(
        sa.text("DROP POLICY agent_versions_tenant_context_isolation ON agent_versions")
    )
    op.execute(
        sa.text(
            f"""
CREATE POLICY agent_versions_tenant_context_isolation ON agent_versions
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  OR tenant_id = '{_PLATFORM_TENANT_ID}'::uuid
)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
"""
        )
    )

    op.execute(
        sa.text(
            "DROP POLICY capability_embeddings_tenant_context_isolation "
            "ON capability_embeddings"
        )
    )
    op.execute(
        sa.text(
            f"""
CREATE POLICY capability_embeddings_tenant_context_isolation ON capability_embeddings
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  OR tenant_id = '{_PLATFORM_TENANT_ID}'::uuid
)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
"""
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "DROP POLICY capability_embeddings_tenant_context_isolation "
            "ON capability_embeddings"
        )
    )
    op.execute(
        sa.text(
            """
CREATE POLICY capability_embeddings_tenant_context_isolation ON capability_embeddings
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
"""
        )
    )

    op.execute(
        sa.text("DROP POLICY agent_versions_tenant_context_isolation ON agent_versions")
    )
    op.execute(
        sa.text(
            """
CREATE POLICY agent_versions_tenant_context_isolation ON agent_versions
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
"""
        )
    )

    op.execute(sa.text("DROP POLICY agents_tenant_context_isolation ON agents"))
    op.execute(
        sa.text(
            """
CREATE POLICY agents_tenant_context_isolation ON agents
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
"""
        )
    )

    op.execute(sa.text("ALTER TABLE agents DROP CONSTRAINT agents_global_workspace_check"))
    op.execute(sa.text("ALTER TABLE agents ALTER COLUMN workspace_id SET NOT NULL"))
