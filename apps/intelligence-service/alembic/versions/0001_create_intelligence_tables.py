"""create intelligence tables

Revision ID: 0001
Revises:
Create Date: 2026-07-26

Covers: agents, agent_versions, capability_embeddings, performance_records.
All tables: tenant_id mandatory+immutable, RLS ENABLE+FORCE, default-deny policy.
capability_embeddings requires pgvector extension (CREATE EXTENSION IF NOT EXISTS vector).
reject_tenant_id_change() defined once, reused across all four tables.
No cross-database foreign keys — run_id in performance_records is an external reference only.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS vector"))

    # reject_tenant_id_change: defined once, reused by all four tables
    op.execute(
        sa.text("""
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
""")
    )

    # ── agents ────────────────────────────────────────────────────────────────
    op.execute(
        sa.text("""
CREATE TABLE agents (
  id               TEXT         PRIMARY KEY NOT NULL,
  tenant_id        UUID         NOT NULL,
  workspace_id     UUID         NOT NULL,
  name             TEXT         NOT NULL,
  tier             TEXT         NOT NULL,
  persona_description TEXT      NOT NULL DEFAULT '',
  status           TEXT         NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT agents_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT agents_tier_check CHECK (tier IN ('FAST', 'STANDARD', 'ADVANCED', 'CEILING')),
  CONSTRAINT agents_status_check CHECK (status IN ('draft', 'active', 'deprecated'))
)
""")
    )

    op.execute(
        sa.text("""
CREATE TRIGGER agents_reject_tenant_id_change
BEFORE UPDATE ON agents
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()
""")
    )

    op.execute(sa.text("ALTER TABLE agents ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE agents FORCE ROW LEVEL SECURITY"))

    op.execute(
        sa.text("""
CREATE POLICY agents_tenant_context_isolation ON agents
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )

    op.execute(
        sa.text("CREATE INDEX idx_agents_tenant_status ON agents (tenant_id, status)")
    )
    op.execute(
        sa.text("CREATE INDEX idx_agents_workspace ON agents (workspace_id)")
    )

    # ── agent_versions ────────────────────────────────────────────────────────
    op.execute(
        sa.text("""
CREATE TABLE agent_versions (
  id             TEXT        PRIMARY KEY NOT NULL,
  agent_id       TEXT        NOT NULL,
  tenant_id      UUID        NOT NULL,
  version_number INTEGER     NOT NULL,
  config         JSONB       NOT NULL DEFAULT '{}',
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_versions_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT agent_versions_agent_version_unique UNIQUE (tenant_id, agent_id, version_number),
  CONSTRAINT agent_versions_agent_tenant_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents (tenant_id, id)
)
""")
    )

    op.execute(
        sa.text("""
CREATE TRIGGER agent_versions_reject_tenant_id_change
BEFORE UPDATE ON agent_versions
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()
""")
    )

    op.execute(sa.text("ALTER TABLE agent_versions ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE agent_versions FORCE ROW LEVEL SECURITY"))

    op.execute(
        sa.text("""
CREATE POLICY agent_versions_tenant_context_isolation ON agent_versions
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )

    op.execute(
        sa.text(
            "CREATE INDEX idx_agent_versions_agent ON agent_versions (tenant_id, agent_id)"
        )
    )

    # ── capability_embeddings ─────────────────────────────────────────────────
    # 512-dim per spec ("512-dim cache+capability").
    # embedding_metadata JSONB is mandatory — records space/scope provenance.
    # HNSW index enables sub-linear ANN search for Selection & Binding.
    op.execute(
        sa.text("""
CREATE TABLE capability_embeddings (
  id                   TEXT        PRIMARY KEY NOT NULL,
  agent_id             TEXT        NOT NULL,
  tenant_id            UUID        NOT NULL,
  capability_description TEXT      NOT NULL,
  embedding            vector(512) NOT NULL,
  embedding_metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT capability_embeddings_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT capability_embeddings_agent_tenant_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents (tenant_id, id)
)
""")
    )

    op.execute(
        sa.text("""
CREATE TRIGGER capability_embeddings_reject_tenant_id_change
BEFORE UPDATE ON capability_embeddings
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()
""")
    )

    op.execute(
        sa.text("ALTER TABLE capability_embeddings ENABLE ROW LEVEL SECURITY")
    )
    op.execute(
        sa.text("ALTER TABLE capability_embeddings FORCE ROW LEVEL SECURITY")
    )

    op.execute(
        sa.text("""
CREATE POLICY capability_embeddings_tenant_context_isolation ON capability_embeddings
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )

    # HNSW index: m=16, ef_construction=64 — good defaults for 512-dim cosine search
    op.execute(
        sa.text("""
CREATE INDEX idx_capability_embeddings_hnsw
ON capability_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
""")
    )
    op.execute(
        sa.text(
            "CREATE INDEX idx_capability_embeddings_agent"
            " ON capability_embeddings (tenant_id, agent_id)"
        )
    )

    # ── performance_records ───────────────────────────────────────────────────
    # Append-only. run_id is a cross-service external reference — no FK.
    op.execute(
        sa.text("""
CREATE TABLE performance_records (
  id            TEXT        PRIMARY KEY NOT NULL,
  agent_id      TEXT        NOT NULL,
  tenant_id     UUID        NOT NULL,
  run_id        TEXT,
  node_type     TEXT,
  task_category TEXT,
  verdict       TEXT        NOT NULL,
  latency_ms    INTEGER,
  token_count   INTEGER,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT performance_records_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT performance_records_agent_tenant_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents (tenant_id, id),
  CONSTRAINT performance_records_verdict_check
    CHECK (verdict IN ('success', 'failure', 'partial', 'escalated'))
)
""")
    )

    op.execute(
        sa.text("""
CREATE TRIGGER performance_records_reject_tenant_id_change
BEFORE UPDATE ON performance_records
FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()
""")
    )

    op.execute(
        sa.text("ALTER TABLE performance_records ENABLE ROW LEVEL SECURITY")
    )
    op.execute(
        sa.text("ALTER TABLE performance_records FORCE ROW LEVEL SECURITY")
    )

    op.execute(
        sa.text("""
CREATE POLICY performance_records_tenant_context_isolation ON performance_records
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )

    op.execute(
        sa.text(
            "CREATE INDEX idx_performance_records_agent_verdict"
            " ON performance_records (agent_id, verdict)"
        )
    )
    op.execute(
        sa.text(
            "CREATE INDEX idx_performance_records_tenant_time"
            " ON performance_records (tenant_id, recorded_at DESC)"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS performance_records"))
    op.execute(sa.text("DROP TABLE IF EXISTS capability_embeddings"))
    op.execute(sa.text("DROP TABLE IF EXISTS agent_versions"))
    op.execute(sa.text("DROP TABLE IF EXISTS agents"))
    op.execute(sa.text("DROP FUNCTION IF EXISTS reject_tenant_id_change()"))
