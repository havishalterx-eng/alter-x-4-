"""split agent_versions.config into typed columns

Revision ID: 0004
Revises: 0003

agent_versions.config was a single opaque JSONB blob. The only real writer
(agent_auto_creation/engine.py) always wrote the same 3 real sub-fields
(capability_profile.capabilities, capability_profile.model_alias,
capability_profile.tools, persona_description) -- and grep-confirmed there
has never been a real reader anywhere in the codebase (selection_binding's
two agent_versions queries only ever select version_number). Splits those
real fields into typed, indexable columns instead of an opaque blob;
config's own third key (`tier`) is dropped rather than carried forward --
it duplicated agents.tier (an agent-level identity fact) and never
belonged on a per-version config row.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
ALTER TABLE agent_versions
  ADD COLUMN capabilities JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN model_alias TEXT,
  ADD COLUMN tools JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN persona_description TEXT,
  ADD CONSTRAINT agent_versions_model_alias_check
    CHECK (model_alias IS NULL OR model_alias IN ('FAST', 'STANDARD', 'ADVANCED', 'CEILING'))
"""
        )
    )
    op.execute(
        sa.text(
            """
UPDATE agent_versions
SET
  capabilities = COALESCE(config #> '{capability_profile,capabilities}', '[]'::jsonb),
  model_alias = config #>> '{capability_profile,model_alias}',
  tools = COALESCE(config #> '{capability_profile,tools}', '[]'::jsonb),
  persona_description = config ->> 'persona_description'
WHERE config <> '{}'::jsonb
"""
        )
    )
    op.execute(sa.text("ALTER TABLE agent_versions DROP COLUMN config"))


def downgrade() -> None:
    op.execute(
        sa.text("ALTER TABLE agent_versions ADD COLUMN config JSONB NOT NULL DEFAULT '{}'")
    )
    op.execute(
        sa.text(
            """
UPDATE agent_versions
SET config = jsonb_strip_nulls(jsonb_build_object(
  'capability_profile', jsonb_strip_nulls(jsonb_build_object(
    'capabilities', capabilities,
    'model_alias', model_alias,
    'tools', tools
  )),
  'persona_description', persona_description
))
"""
        )
    )
    op.execute(
        sa.text(
            """
ALTER TABLE agent_versions
  DROP CONSTRAINT agent_versions_model_alias_check,
  DROP COLUMN capabilities,
  DROP COLUMN model_alias,
  DROP COLUMN tools,
  DROP COLUMN persona_description
"""
        )
    )
