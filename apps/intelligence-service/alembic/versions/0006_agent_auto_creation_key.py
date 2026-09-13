"""give auto-created agents an idempotency key

Revision ID: 0006
Revises: 0005

Auto-creation had no lookup, no ON CONFLICT and no unique constraint: three
inserts, unconditionally, on every call. Once the tier bug is fixed a repeated
*sequential* request converges on its own, because the agent it created now
passes the tier filter that caused the no-match -- but two concurrent requests
still both see no candidate and both insert. This is the constraint that makes
the second one a no-op.

Keyed on (tenant_id, workspace_id, auto_creation_key), where the key is a
SHA-256 of the requirement's capability set. Tier is deliberately not in the
key: creation only ever happens when no agent in the workspace has the
capability at all, so a second request at a different tier is a tier gap
against the agent this one created, never another capability gap.

The index is partial. Agents created by any other path carry NULL here and are
untouched by it -- NULLs are distinct in Postgres, so they neither collide with
each other nor with an auto-created row. Global (platform-tenant) agents have a
NULL workspace_id and so are also never deduplicated by this index; auto-
creation always writes a real workspace_id from the request, so it never mints
one.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE agents ADD COLUMN auto_creation_key text"))
    op.execute(
        sa.text(
            """
CREATE UNIQUE INDEX agents_auto_creation_key_unique
  ON agents (tenant_id, workspace_id, auto_creation_key)
  WHERE auto_creation_key IS NOT NULL
"""
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS agents_auto_creation_key_unique"))
    op.execute(sa.text("ALTER TABLE agents DROP COLUMN auto_creation_key"))
