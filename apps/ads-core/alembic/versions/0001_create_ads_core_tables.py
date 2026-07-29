# ruff: noqa: E501
"""create ads_db tables (ADS Core, doc 04 section 9)

Revision ID: 0001
Revises:
Create Date: 2026-07-29

Covers: scopes, sources, documents, document_versions, chunks, records,
memory_namespace, ingestion_jobs, retrieval_audit. Own Aurora cluster
(terraform "alter-<env>-ads", KNOW-1, already merged) -- no foreign keys
into any other service's database; external IDs (integration_ref,
project_ref) are opaque references only, per doc 04 section 12 ("ADS never
references orchestration rows directly -- provenance stores opaque run/node
refs"). document_id on chunks/document_versions is a same-DB, in-cluster
FK, not an external reference.

reject_tenant_id_change() defined once, reused by every tenant-scoped table.

Design decision -- document_versions has NO tenant_id column (doc 04's own
ASCII schema omits it here, unlike every other table which explicitly lists
"tenant_id / scope_id uuid NOT NULL"). Tenant scoping is inherited through
its FK to documents. RLS uses an EXISTS-join against documents instead of a
direct current_setting comparison -- the same pattern KNOW-12's
policy_promotions already established for a dependent child row with no
tenant_id of its own. This is the faithful reading of the doc, not an
invented shortcut.

Design decision -- records.entity_type has NO CHECK constraint. Doc 04 lists
"product | customer | order | inventory | invoice | ..." -- the trailing
"..." signals an open, extensible set (unlike every other kind/status column
in this migration, which doc lists as closed enumerations with no "..."). A
CHECK constraint here would silently reject legitimate future entity types
doc 04 already says to expect.

Same-cluster FKs use the (tenant_id, id) composite pattern already
established in apps/intelligence-service's migration (agents /
agent_versions), requiring a UNIQUE(tenant_id, id) on every referenced
parent -- enforces tenant match at the FK, not just at the app layer.
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

    # ── scopes ────────────────────────────────────────────────────────────────
    op.execute(
        sa.text("""
CREATE TABLE scopes (
  id           TEXT        PRIMARY KEY NOT NULL,
  tenant_id    UUID        NOT NULL,
  workspace_id UUID        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scopes_tenant_id_id_unique UNIQUE (tenant_id, id)
)
""")
    )
    op.execute(
        sa.text(
            "CREATE TRIGGER scopes_reject_tenant_id_change "
            "BEFORE UPDATE ON scopes FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()"
        )
    )
    op.execute(sa.text("ALTER TABLE scopes ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE scopes FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY scopes_tenant_context_isolation ON scopes
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )
    op.execute(sa.text("CREATE INDEX idx_scopes_workspace ON scopes (workspace_id)"))

    # ── sources ───────────────────────────────────────────────────────────────
    op.execute(
        sa.text("""
CREATE TABLE sources (
  id              TEXT        PRIMARY KEY NOT NULL,
  tenant_id       UUID        NOT NULL,
  scope_id        TEXT        NOT NULL,
  kind            TEXT        NOT NULL,
  provider        TEXT,
  integration_ref UUID,
  sync_config     JSONB,
  status          TEXT,
  last_sync_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sources_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT sources_scope_tenant_fk
    FOREIGN KEY (tenant_id, scope_id) REFERENCES scopes (tenant_id, id),
  CONSTRAINT sources_kind_check
    CHECK (kind IN ('upload', 'connector', 'engine_writeback', 'platform_input'))
)
""")
    )
    op.execute(
        sa.text(
            "CREATE TRIGGER sources_reject_tenant_id_change "
            "BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()"
        )
    )
    op.execute(sa.text("ALTER TABLE sources ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE sources FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY sources_tenant_context_isolation ON sources
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )
    op.execute(sa.text("CREATE INDEX idx_sources_scope ON sources (tenant_id, scope_id)"))

    # ── documents ─────────────────────────────────────────────────────────────
    op.execute(
        sa.text("""
CREATE TABLE documents (
  id               TEXT        PRIMARY KEY NOT NULL,
  tenant_id        UUID        NOT NULL,
  scope_id         TEXT        NOT NULL,
  source_id        TEXT        NOT NULL,
  kind             TEXT        NOT NULL,
  title            TEXT,
  current_version  INTEGER     NOT NULL,
  permissions      JSONB,
  status           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT documents_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT documents_scope_tenant_fk
    FOREIGN KEY (tenant_id, scope_id) REFERENCES scopes (tenant_id, id),
  CONSTRAINT documents_source_tenant_fk
    FOREIGN KEY (tenant_id, source_id) REFERENCES sources (tenant_id, id),
  CONSTRAINT documents_kind_check
    CHECK (kind IN ('file', 'record', 'rule', 'summary', 'verified_output', 'project_context')),
  CONSTRAINT documents_status_check
    CHECK (status IS NULL OR status IN ('active', 'superseded', 'deleted'))
)
""")
    )
    op.execute(
        sa.text(
            "CREATE TRIGGER documents_reject_tenant_id_change "
            "BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()"
        )
    )
    op.execute(sa.text("ALTER TABLE documents ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE documents FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY documents_tenant_context_isolation ON documents
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )
    op.execute(sa.text("CREATE INDEX idx_documents_scope ON documents (tenant_id, scope_id)"))
    op.execute(sa.text("CREATE INDEX idx_documents_source ON documents (tenant_id, source_id)"))

    # ── document_versions (immutable; no own tenant_id, see module docstring) ──
    op.execute(
        sa.text("""
CREATE TABLE document_versions (
  document_id       TEXT        NOT NULL,
  version           INTEGER     NOT NULL,
  content_ref       TEXT        NOT NULL,
  content_hash      TEXT,
  normalized_ref    TEXT,
  freshness_at      TIMESTAMPTZ,
  provenance        JSONB       NOT NULL,
  ingestion_job_id  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, version),
  CONSTRAINT document_versions_document_fk
    FOREIGN KEY (document_id) REFERENCES documents (id)
)
""")
    )
    op.execute(sa.text("ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE document_versions FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY document_versions_via_document ON document_versions
USING (EXISTS (
  SELECT 1 FROM documents d WHERE d.id = document_versions.document_id
  AND d.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
))
WITH CHECK (EXISTS (
  SELECT 1 FROM documents d WHERE d.id = document_versions.document_id
  AND d.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
))
""")
    )

    # ── chunks (retrieval units, 1024-dim + FTS) ───────────────────────────────
    op.execute(
        sa.text("""
CREATE TABLE chunks (
  id                   TEXT         PRIMARY KEY NOT NULL,
  tenant_id            UUID         NOT NULL,
  scope_id             TEXT         NOT NULL,
  document_id          TEXT         NOT NULL,
  document_version     INTEGER      NOT NULL,
  seq                  INTEGER      NOT NULL,
  text_content         TEXT         NOT NULL,
  metadata             JSONB,
  embedding            vector(1024) NOT NULL,
  embedding_provider   TEXT         NOT NULL,
  embedding_model      TEXT         NOT NULL,
  embedding_version    TEXT         NOT NULL,
  distance_metric      TEXT         NOT NULL DEFAULT 'cosine',
  text_search          tsvector     GENERATED ALWAYS AS (to_tsvector('english', text_content)) STORED,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chunks_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT chunks_scope_tenant_fk
    FOREIGN KEY (tenant_id, scope_id) REFERENCES scopes (tenant_id, id),
  CONSTRAINT chunks_document_version_fk
    FOREIGN KEY (document_id, document_version) REFERENCES document_versions (document_id, version)
)
""")
    )
    op.execute(
        sa.text(
            "CREATE TRIGGER chunks_reject_tenant_id_change "
            "BEFORE UPDATE ON chunks FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()"
        )
    )
    op.execute(sa.text("ALTER TABLE chunks ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE chunks FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY chunks_tenant_context_isolation ON chunks
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )
    # HNSW index: m=16, ef_construction=64 -- same defaults as intelligence-service's
    # capability_embeddings (512-dim); 1024-dim retrieval space is a separate index,
    # never compared across embedding spaces (doc 04 section 1).
    op.execute(
        sa.text("""
CREATE INDEX idx_chunks_embedding_hnsw
ON chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64)
""")
    )
    op.execute(sa.text("CREATE INDEX idx_chunks_text_search_gin ON chunks USING gin (text_search)"))
    op.execute(sa.text("CREATE INDEX idx_chunks_document ON chunks (document_id, document_version)"))

    # ── records (structured business records; entity_type intentionally open) ──
    op.execute(
        sa.text("""
CREATE TABLE records (
  id            TEXT        PRIMARY KEY NOT NULL,
  tenant_id     UUID        NOT NULL,
  scope_id      TEXT        NOT NULL,
  source_id     TEXT        NOT NULL,
  entity_type   TEXT        NOT NULL,
  external_key  TEXT        NOT NULL,
  body          JSONB       NOT NULL,
  version       INTEGER     NOT NULL,
  freshness_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT records_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT records_scope_tenant_fk
    FOREIGN KEY (tenant_id, scope_id) REFERENCES scopes (tenant_id, id),
  CONSTRAINT records_source_tenant_fk
    FOREIGN KEY (tenant_id, source_id) REFERENCES sources (tenant_id, id),
  CONSTRAINT records_source_entity_key_version_unique
    UNIQUE (source_id, entity_type, external_key, version)
)
""")
    )
    op.execute(
        sa.text(
            "CREATE TRIGGER records_reject_tenant_id_change "
            "BEFORE UPDATE ON records FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()"
        )
    )
    op.execute(sa.text("ALTER TABLE records ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE records FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY records_tenant_context_isolation ON records
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )
    op.execute(sa.text("CREATE INDEX idx_records_scope ON records (tenant_id, scope_id)"))

    # ── memory_namespace (tenant knowledge written by Memory & Learning) ───────
    op.execute(
        sa.text("""
CREATE TABLE memory_namespace (
  id            TEXT        PRIMARY KEY NOT NULL,
  tenant_id     UUID        NOT NULL,
  scope_id      TEXT        NOT NULL,
  project_ref   UUID,
  kind          TEXT        NOT NULL,
  statement     TEXT        NOT NULL,
  confidence    NUMERIC,
  provenance    JSONB       NOT NULL,
  status        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,
  CONSTRAINT memory_namespace_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT memory_namespace_scope_tenant_fk
    FOREIGN KEY (tenant_id, scope_id) REFERENCES scopes (tenant_id, id),
  CONSTRAINT memory_namespace_kind_check
    CHECK (kind IN ('business_rule', 'preference', 'project_fact', 'constraint')),
  CONSTRAINT memory_namespace_status_check
    CHECK (status IS NULL OR status IN ('active', 'superseded', 'revoked'))
)
""")
    )
    op.execute(
        sa.text(
            "CREATE TRIGGER memory_namespace_reject_tenant_id_change "
            "BEFORE UPDATE ON memory_namespace FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()"
        )
    )
    op.execute(sa.text("ALTER TABLE memory_namespace ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE memory_namespace FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY memory_namespace_tenant_context_isolation ON memory_namespace
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )
    op.execute(
        sa.text("CREATE INDEX idx_memory_namespace_scope ON memory_namespace (tenant_id, scope_id)")
    )

    # ── ingestion_jobs ──────────────────────────────────────────────────────────
    op.execute(
        sa.text("""
CREATE TABLE ingestion_jobs (
  id            TEXT        PRIMARY KEY NOT NULL,
  tenant_id     UUID        NOT NULL,
  source_id     TEXT        NOT NULL,
  stage         TEXT        NOT NULL,
  stats         JSONB,
  error         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  CONSTRAINT ingestion_jobs_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT ingestion_jobs_source_tenant_fk
    FOREIGN KEY (tenant_id, source_id) REFERENCES sources (tenant_id, id),
  CONSTRAINT ingestion_jobs_stage_check
    CHECK (stage IN ('received', 'validated', 'scanned', 'normalized', 'deduplicated', 'chunked', 'indexed', 'failed'))
)
""")
    )
    op.execute(
        sa.text(
            "CREATE TRIGGER ingestion_jobs_reject_tenant_id_change "
            "BEFORE UPDATE ON ingestion_jobs FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()"
        )
    )
    op.execute(sa.text("ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE ingestion_jobs FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY ingestion_jobs_tenant_context_isolation ON ingestion_jobs
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )
    op.execute(
        sa.text("CREATE INDEX idx_ingestion_jobs_source ON ingestion_jobs (tenant_id, source_id)")
    )

    # ── retrieval_audit (append-only) ───────────────────────────────────────────
    op.execute(
        sa.text("""
CREATE TABLE retrieval_audit (
  id              TEXT        PRIMARY KEY NOT NULL,
  tenant_id       UUID        NOT NULL,
  scope_id        TEXT        NOT NULL,
  requester       TEXT        NOT NULL,
  query_hash      TEXT,
  result_doc_ids  JSONB,
  confidence      NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT retrieval_audit_tenant_id_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT retrieval_audit_scope_tenant_fk
    FOREIGN KEY (tenant_id, scope_id) REFERENCES scopes (tenant_id, id)
)
""")
    )
    op.execute(
        sa.text(
            "CREATE TRIGGER retrieval_audit_reject_tenant_id_change "
            "BEFORE UPDATE ON retrieval_audit FOR EACH ROW EXECUTE FUNCTION reject_tenant_id_change()"
        )
    )
    op.execute(sa.text("ALTER TABLE retrieval_audit ENABLE ROW LEVEL SECURITY"))
    op.execute(sa.text("ALTER TABLE retrieval_audit FORCE ROW LEVEL SECURITY"))
    op.execute(
        sa.text("""
CREATE POLICY retrieval_audit_tenant_context_isolation ON retrieval_audit
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
""")
    )
    op.execute(
        sa.text(
            "CREATE INDEX idx_retrieval_audit_tenant_time "
            "ON retrieval_audit (tenant_id, created_at DESC)"
        )
    )


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS retrieval_audit"))
    op.execute(sa.text("DROP TABLE IF EXISTS ingestion_jobs"))
    op.execute(sa.text("DROP TABLE IF EXISTS memory_namespace"))
    op.execute(sa.text("DROP TABLE IF EXISTS records"))
    op.execute(sa.text("DROP TABLE IF EXISTS chunks"))
    op.execute(sa.text("DROP TABLE IF EXISTS document_versions"))
    op.execute(sa.text("DROP TABLE IF EXISTS documents"))
    op.execute(sa.text("DROP TABLE IF EXISTS sources"))
    op.execute(sa.text("DROP TABLE IF EXISTS scopes"))
    op.execute(sa.text("DROP FUNCTION IF EXISTS reject_tenant_id_change()"))
