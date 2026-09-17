"""register the canonical tools as global capabilities, labelled

Revision ID: 0008
Revises: 0007

0007 let a record say it has no side effects, but no record existed to say
it: the registry held nothing for tools, and tool nodes named no capability,
so synthesis approved every tool call. This registers each canonical tool
(src/capability_registry/canonical_tools.py) as a global record whose only
capability is tool.<name>, labelled with its side effects. The resolver gives
a ToolCall node that capability, so a plan that searches the web or selects
from the tenant database no longer waits for a person before it.

Idempotent: a tool that already has an active global record is left alone,
so an operator's later supersede survives a re-run. Downgrade removes only
the version-1 records this revision inserted.

The values are copied into the revision rather than imported, so the
migration keeps meaning what it meant if the module changes later.
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PLATFORM_TENANT_ID = "00000000-0000-7000-8000-000000000001"
_PROVENANCE = {"source": "canonical-tool-catalog", "revision": "0008"}
_TOOLS: tuple[tuple[str, bool], ...] = (
    ("search.web", False),
    ("database.select", False),
    ("database.insert", True),
    ("database.update", True),
    ("database.delete", True),
    ("browser.session.create", True),
    ("browser.navigate", True),
    ("browser.click", True),
    ("browser.extract", False),
    ("browser.session.close", True),
    ("email.send", True),
)


def upgrade() -> None:
    # Global rows are owned by the platform tenant; the policy's WITH CHECK
    # admits only rows owned by the current tenant.
    op.execute(
        sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)").bindparams(
            tenant=_PLATFORM_TENANT_ID
        )
    )
    for name, side_effects in _TOOLS:
        capability_id = f"tool.{name}"
        op.execute(
            sa.text(
                """
INSERT INTO capability_registry_versions
  (capability_id, version, owner_tenant_id, scope, workspace_id, kind,
   supported_capabilities, side_effects, constraints, availability, provenance,
   metadata, status)
SELECT :capability_id, 1, CAST(:owner AS uuid), 'global', NULL, 'tool',
       CAST(:capabilities AS jsonb), :side_effects, '{}'::jsonb,
       '{"available": true}'::jsonb, CAST(:provenance AS jsonb), '{}'::jsonb, 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM capability_registry_versions
  WHERE owner_tenant_id = CAST(:owner AS uuid) AND capability_id = :capability_id
)
"""
            ).bindparams(
                capability_id=capability_id,
                owner=_PLATFORM_TENANT_ID,
                capabilities=json.dumps([capability_id]),
                side_effects=side_effects,
                provenance=json.dumps(_PROVENANCE),
            )
        )


def downgrade() -> None:
    op.execute(
        sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)").bindparams(
            tenant=_PLATFORM_TENANT_ID
        )
    )
    op.execute(
        sa.text(
            """
DELETE FROM capability_registry_versions
WHERE owner_tenant_id = CAST(:owner AS uuid)
  AND version = 1
  AND provenance ->> 'source' = 'canonical-tool-catalog'
"""
        ).bindparams(owner=_PLATFORM_TENANT_ID)
    )
