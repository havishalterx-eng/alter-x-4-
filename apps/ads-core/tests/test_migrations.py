# ruff: noqa: E501
"""
ADS Core (ads_db) migration tests.

Static tests: inspect migration source for required SQL constructs.
Integration tests: spin real Postgres+pgvector via testcontainers,
  run alembic upgrade head, verify schema, tenant isolation, immutability,
  vector dimension enforcement, full-text search.
"""

import re
from collections.abc import Generator
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from testcontainers.community.postgres import PostgresContainer

from alembic import command

# ── paths ─────────────────────────────────────────────────────────────────────
SERVICE_ROOT = Path(__file__).parent.parent
VERSIONS_DIR = SERVICE_ROOT / "alembic" / "versions"
MIGRATION_FILE = VERSIONS_DIR / "0001_create_ads_core_tables.py"

TABLES = [
    "scopes",
    "sources",
    "documents",
    "document_versions",
    "chunks",
    "records",
    "memory_namespace",
    "ingestion_jobs",
    "retrieval_audit",
]
# document_versions has no tenant_id column (see migration docstring) --
# every other table does and gets the standard immutability trigger + the
# direct current_setting RLS policy.
TENANT_SCOPED_TABLES = [t for t in TABLES if t != "document_versions"]
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"


# ── static tests ───────────────────────────────────────────────────────────────
class TestMigrationFileStructure:
    def test_migration_file_exists(self) -> None:
        assert MIGRATION_FILE.exists(), f"Missing migration: {MIGRATION_FILE}"

    def test_single_migration_in_versions(self) -> None:
        py_files = sorted(f.name for f in VERSIONS_DIR.glob("*.py") if f.name != "__init__.py")
        assert py_files == [
            "0001_create_ads_core_tables.py",
            "0002_retrieval_safety_audit.py",
            "0003_source_permissions.py",
        ]

    def test_all_tables_defined(self) -> None:
        sql = MIGRATION_FILE.read_text()
        for table in TABLES:
            assert f"CREATE TABLE {table}" in sql, f"Missing CREATE TABLE {table}"

    def test_rls_enable_force_on_all_tables(self) -> None:
        sql = MIGRATION_FILE.read_text()
        for table in TABLES:
            assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
            assert f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY" in sql

    def test_tenant_context_policy_on_tenant_scoped_tables(self) -> None:
        sql = MIGRATION_FILE.read_text()
        for table in TENANT_SCOPED_TABLES:
            assert f"CREATE POLICY {table}_tenant_context_isolation ON {table}" in sql
        assert "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid" in sql

    def test_document_versions_uses_exists_join_not_direct_tenant_id(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert "CREATE POLICY document_versions_via_document ON document_versions" in sql
        assert "EXISTS (" in sql
        assert "document_versions_tenant_context_isolation" not in sql

    def test_reject_tenant_id_change_defined_once_used_per_tenant_scoped_table(self) -> None:
        sql = MIGRATION_FILE.read_text()
        defs = re.findall(r"CREATE OR REPLACE FUNCTION reject_tenant_id_change", sql)
        assert len(defs) == 1, f"Expected 1 definition, got {len(defs)}"
        uses = re.findall(r"EXECUTE FUNCTION reject_tenant_id_change\(\)", sql)
        assert len(uses) == len(TENANT_SCOPED_TABLES), (
            f"Expected {len(TENANT_SCOPED_TABLES)} uses (one per tenant-scoped table), got {len(uses)}"
        )

    def test_no_cross_database_references(self) -> None:
        sql = MIGRATION_FILE.read_text()
        for forbidden in [
            "orchestration_db",
            "audit_db",
            "platform_db",
            "policy_db",
            "intelligence_db",
            "cost_db",
            "eval_db",
        ]:
            assert forbidden not in sql, f"Cross-DB reference found: {forbidden}"

    def test_chunks_vector_1024(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert "vector(1024)" in sql

    def test_pgvector_extension_created(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert "CREATE EXTENSION IF NOT EXISTS vector" in sql

    def test_hnsw_index_on_chunks_embedding(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert "USING hnsw (embedding vector_cosine_ops)" in sql
        assert "idx_chunks_embedding_hnsw" in sql

    def test_gin_index_on_chunks_text_search(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert "idx_chunks_text_search_gin" in sql
        assert "USING gin (text_search)" in sql
        assert "GENERATED ALWAYS AS (to_tsvector('english', text_content)) STORED" in sql

    def test_records_entity_type_has_no_check_constraint(self) -> None:
        """doc 04's entity_type list ends in '...' -- an open, extensible set,
        unlike every other kind/status column here. No CHECK constraint by
        design (see migration docstring)."""
        sql = MIGRATION_FILE.read_text()
        assert "entity_type_check" not in sql

    def test_sources_kind_check(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert "kind IN ('upload', 'connector', 'engine_writeback', 'platform_input')" in sql

    def test_documents_kind_and_status_check(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert (
            "kind IN ('file', 'record', 'rule', 'summary', 'verified_output', 'project_context')"
            in sql
        )
        assert "status IN ('active', 'superseded', 'deleted')" in sql

    def test_ingestion_jobs_stage_check(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert (
            "stage IN ('received', 'validated', 'scanned', 'normalized', "
            "'deduplicated', 'chunked', 'indexed', 'failed')" in sql
        )

    def test_memory_namespace_kind_and_status_check(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert "kind IN ('business_rule', 'preference', 'project_fact', 'constraint')" in sql
        assert "status IN ('active', 'superseded', 'revoked')" in sql

    def test_records_unique_source_entity_key_version(self) -> None:
        sql = MIGRATION_FILE.read_text()
        assert "UNIQUE (source_id, entity_type, external_key, version)" in sql

    def test_downgrade_drops_all_tables(self) -> None:
        sql = MIGRATION_FILE.read_text()
        for table in TABLES:
            assert f"DROP TABLE IF EXISTS {table}" in sql


# ── integration tests (testcontainers) ────────────────────────────────────────
@pytest.fixture(scope="module")
def pg_url() -> Generator[str, None, None]:
    """Start pgvector/pgvector:pg16 container, run migrations, yield sync URL."""
    with PostgresContainer(
        image=PGVECTOR_IMAGE,
        dbname="ads_db",
        username="ads_core",
        password="testpass",
    ) as pg:
        sync_url = pg.get_connection_url()

        alembic_cfg = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        alembic_cfg.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        alembic_cfg.set_main_option("sqlalchemy.url", sync_url)

        command.upgrade(alembic_cfg, "head")

        yield sync_url


@pytest.fixture
def conn(pg_url: str) -> Generator[sa.engine.Connection, None, None]:
    engine = sa.create_engine(pg_url)
    with engine.connect() as c:
        yield c
        c.rollback()


def _set_tenant(conn: sa.engine.Connection, tenant_id: str) -> None:
    conn.execute(sa.text(f"SET app.current_tenant_id = '{tenant_id}'"))


def _seed_scope_source_document(
    conn: sa.engine.Connection,
    tenant_id: str,
    workspace_id: str,
    scope_id: str,
    source_id: str,
    document_id: str,
) -> None:
    _set_tenant(conn, tenant_id)
    conn.execute(
        sa.text("INSERT INTO scopes (id, tenant_id, workspace_id) VALUES (:s, :t, :ws)"),
        {"s": scope_id, "t": tenant_id, "ws": workspace_id},
    )
    conn.execute(
        sa.text(
            "INSERT INTO sources (id, tenant_id, scope_id, kind) "
            "VALUES (:src, :t, :s, 'upload')"
        ),
        {"src": source_id, "t": tenant_id, "s": scope_id},
    )
    conn.execute(
        sa.text(
            "INSERT INTO documents (id, tenant_id, scope_id, source_id, kind, current_version) "
            "VALUES (:d, :t, :s, :src, 'file', 1)"
        ),
        {"d": document_id, "t": tenant_id, "s": scope_id, "src": source_id},
    )


class TestSchemaAfterMigration:
    def test_all_tables_exist(self, conn: sa.engine.Connection) -> None:
        for table in TABLES:
            result = conn.execute(
                sa.text(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema='public' AND table_name=:t"
                ),
                {"t": table},
            )
            assert result.scalar() == 1, f"Table missing: {table}"

    def test_vector_extension_installed(self, conn: sa.engine.Connection) -> None:
        result = conn.execute(sa.text("SELECT 1 FROM pg_extension WHERE extname='vector'"))
        assert result.scalar() == 1

    def test_chunks_embedding_column_is_1024_dim(self, conn: sa.engine.Connection) -> None:
        result = conn.execute(
            sa.text(
                "SELECT atttypmod FROM pg_attribute "
                "JOIN pg_class ON attrelid = pg_class.oid "
                "WHERE relname = 'chunks' AND attname = 'embedding'"
            )
        )
        typmod = result.scalar()
        assert typmod == 1024, f"Expected 1024-dim embedding, got typmod={typmod}"

    def test_rls_enabled_on_all_tables(self, conn: sa.engine.Connection) -> None:
        result = conn.execute(
            sa.text(
                "SELECT relname FROM pg_class "
                "WHERE relrowsecurity = true AND relforcerowsecurity = true "
                "AND relname = ANY(:tables)"
            ),
            {"tables": TABLES},
        )
        enabled = {row[0] for row in result}
        assert enabled == set(TABLES), f"RLS not ENABLED+FORCED on: {set(TABLES) - enabled}"


class TestTenantIsolation:
    def test_scope_only_visible_to_owning_tenant(self, pg_url: str) -> None:
        # testcontainers creates the primary user as a superuser, and PostgreSQL
        # superusers bypass RLS even with FORCE ROW LEVEL SECURITY. Create a
        # non-superuser role and SET ROLE to it to actually exercise the policy.
        tenant_a = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa"
        tenant_b = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb"
        ws = "cccccccc-0000-4000-8000-cccccccccccc"

        setup_engine = sa.create_engine(pg_url, isolation_level="AUTOCOMMIT")
        with setup_engine.connect() as setup:
            setup.execute(sa.text("DROP ROLE IF EXISTS ads_rls_test_reader"))
            setup.execute(sa.text("CREATE ROLE ads_rls_test_reader"))
            setup.execute(sa.text("GRANT SELECT, INSERT ON scopes TO ads_rls_test_reader"))

        engine = sa.create_engine(pg_url)
        with engine.connect() as c:
            _set_tenant(c, tenant_a)
            c.execute(
                sa.text("INSERT INTO scopes (id, tenant_id, workspace_id) VALUES ('scp_rls-a', :t, :ws)"),
                {"t": tenant_a, "ws": ws},
            )
            c.commit()

            c.execute(sa.text("SET ROLE ads_rls_test_reader"))

            _set_tenant(c, tenant_b)
            count = c.execute(
                sa.text("SELECT count(*) FROM scopes WHERE id = 'scp_rls-a'")
            ).scalar()
            assert count == 0, "RLS must hide tenant_a row from tenant_b context"

            _set_tenant(c, tenant_a)
            count = c.execute(
                sa.text("SELECT count(*) FROM scopes WHERE id = 'scp_rls-a'")
            ).scalar()
            assert count == 1, "RLS must show tenant_a row in tenant_a context"

            c.execute(sa.text("RESET ROLE"))
            c.rollback()

    def test_document_versions_visible_only_via_owning_document(self, pg_url: str) -> None:
        # Same superuser-bypasses-RLS caveat as test_scope_only_visible_to_owning_tenant
        # above -- must SET ROLE to a non-superuser to actually exercise the policy.
        tenant_a = "d0000000-0000-4000-8000-000000000001"
        tenant_b = "d0000000-0000-4000-8000-000000000002"
        ws = "d0000000-0000-4000-8000-000000000003"

        setup_engine = sa.create_engine(pg_url, isolation_level="AUTOCOMMIT")
        with setup_engine.connect() as setup:
            setup.execute(sa.text("DROP ROLE IF EXISTS ads_rls_dv_reader"))
            setup.execute(sa.text("CREATE ROLE ads_rls_dv_reader"))
            setup.execute(
                sa.text(
                    "GRANT SELECT, INSERT ON scopes, sources, documents, document_versions "
                    "TO ads_rls_dv_reader"
                )
            )

        engine = sa.create_engine(pg_url)
        with engine.connect() as c:
            _seed_scope_source_document(c, tenant_a, ws, "scp_dv-a", "src_dv-a", "doc_dv-a")
            c.execute(
                sa.text(
                    "INSERT INTO document_versions (document_id, version, content_ref, provenance) "
                    "VALUES ('doc_dv-a', 1, 's3://x', '{}'::jsonb)"
                )
            )
            c.commit()

            c.execute(sa.text("SET ROLE ads_rls_dv_reader"))

            _set_tenant(c, tenant_b)
            count = c.execute(
                sa.text("SELECT count(*) FROM document_versions WHERE document_id = 'doc_dv-a'")
            ).scalar()
            assert count == 0, "document_versions must be invisible when its owning document isn't tenant_b's"

            _set_tenant(c, tenant_a)
            count = c.execute(
                sa.text("SELECT count(*) FROM document_versions WHERE document_id = 'doc_dv-a'")
            ).scalar()
            assert count == 1, "document_versions must be visible when its owning document is tenant_a's"

            c.execute(sa.text("RESET ROLE"))
            c.rollback()


class TestTenantIdImmutability:
    def test_scope_tenant_id_is_immutable(self, conn: sa.engine.Connection) -> None:
        tenant = "e0000000-0000-4000-8000-000000000001"
        other = "e0000000-0000-4000-8000-000000000002"
        ws = "e0000000-0000-4000-8000-000000000003"

        _set_tenant(conn, tenant)
        conn.execute(
            sa.text("INSERT INTO scopes (id, tenant_id, workspace_id) VALUES ('scp_immut', :t, :ws)"),
            {"t": tenant, "ws": ws},
        )

        with pytest.raises(Exception, match="tenant_id is immutable"):
            conn.execute(
                sa.text("UPDATE scopes SET tenant_id = :other WHERE id = 'scp_immut'"),
                {"other": other},
            )

    def test_chunk_tenant_id_is_immutable(self, conn: sa.engine.Connection) -> None:
        tenant = "f0000000-0000-4000-8000-000000000001"
        other = "f0000000-0000-4000-8000-000000000002"
        ws = "f0000000-0000-4000-8000-000000000003"

        _seed_scope_source_document(conn, tenant, ws, "scp_chk-immut", "src_chk-immut", "doc_chk-immut")
        conn.execute(
            sa.text(
                "INSERT INTO document_versions (document_id, version, content_ref, provenance) "
                "VALUES ('doc_chk-immut', 1, 's3://x', '{}'::jsonb)"
            )
        )
        vec = "[" + ",".join(["0.1"] * 1024) + "]"
        conn.execute(
            sa.text(
                "INSERT INTO chunks (id, tenant_id, scope_id, document_id, document_version, "
                "seq, text_content, embedding, embedding_provider, embedding_model, embedding_version) "
                f"VALUES ('chk_immut', :t, 'scp_chk-immut', 'doc_chk-immut', 1, 0, 'hello world', "
                f"'{vec}'::vector, 'titan', 'text-embed-v2', 'v2')"
            ),
            {"t": tenant},
        )

        with pytest.raises(Exception, match="tenant_id is immutable"):
            conn.execute(
                sa.text("UPDATE chunks SET tenant_id = :other WHERE id = 'chk_immut'"),
                {"other": other},
            )


class TestVectorDimension:
    def test_wrong_dimension_embedding_rejected(self, conn: sa.engine.Connection) -> None:
        tenant = "10000000-0000-4000-8000-000000000001"
        ws = "10000000-0000-4000-8000-000000000002"

        _seed_scope_source_document(conn, tenant, ws, "scp_vec-wrong", "src_vec-wrong", "doc_vec-wrong")
        conn.execute(
            sa.text(
                "INSERT INTO document_versions (document_id, version, content_ref, provenance) "
                "VALUES ('doc_vec-wrong', 1, 's3://x', '{}'::jsonb)"
            )
        )

        wrong_dim = "[" + ",".join(["0.1"] * 256) + "]"  # 256-dim, not 1024
        with pytest.raises(Exception):
            conn.execute(
                sa.text(
                    "INSERT INTO chunks (id, tenant_id, scope_id, document_id, document_version, "
                    "seq, text_content, embedding, embedding_provider, embedding_model, embedding_version) "
                    f"VALUES ('chk_wrong', :t, 'scp_vec-wrong', 'doc_vec-wrong', 1, 0, 'x', "
                    f"'{wrong_dim}'::vector, 'titan', 'text-embed-v2', 'v2')"
                ),
                {"t": tenant},
            )

    def test_correct_dimension_embedding_accepted(self, conn: sa.engine.Connection) -> None:
        tenant = "20000000-0000-4000-8000-000000000001"
        ws = "20000000-0000-4000-8000-000000000002"

        _seed_scope_source_document(conn, tenant, ws, "scp_vec-ok", "src_vec-ok", "doc_vec-ok")
        conn.execute(
            sa.text(
                "INSERT INTO document_versions (document_id, version, content_ref, provenance) "
                "VALUES ('doc_vec-ok', 1, 's3://x', '{}'::jsonb)"
            )
        )

        correct_dim = "[" + ",".join(["0.1"] * 1024) + "]"
        conn.execute(
            sa.text(
                "INSERT INTO chunks (id, tenant_id, scope_id, document_id, document_version, "
                "seq, text_content, embedding, embedding_provider, embedding_model, embedding_version) "
                f"VALUES ('chk_ok', :t, 'scp_vec-ok', 'doc_vec-ok', 1, 0, 'x', "
                f"'{correct_dim}'::vector, 'titan', 'text-embed-v2', 'v2')"
            ),
            {"t": tenant},
        )

        count = conn.execute(
            sa.text("SELECT count(*) FROM chunks WHERE id = 'chk_ok'")
        ).scalar()
        assert count == 1


class TestFullTextSearch:
    def test_text_search_generated_column_matches_keyword_query(
        self, conn: sa.engine.Connection
    ) -> None:
        tenant = "30000000-0000-4000-8000-000000000001"
        ws = "30000000-0000-4000-8000-000000000002"

        _seed_scope_source_document(conn, tenant, ws, "scp_fts", "src_fts", "doc_fts")
        conn.execute(
            sa.text(
                "INSERT INTO document_versions (document_id, version, content_ref, provenance) "
                "VALUES ('doc_fts', 1, 's3://x', '{}'::jsonb)"
            )
        )
        vec = "[" + ",".join(["0.1"] * 1024) + "]"
        conn.execute(
            sa.text(
                "INSERT INTO chunks (id, tenant_id, scope_id, document_id, document_version, "
                "seq, text_content, embedding, embedding_provider, embedding_model, embedding_version) "
                f"VALUES ('chk_fts', :t, 'scp_fts', 'doc_fts', 1, 0, "
                f"'refunds are processed within thirty days', '{vec}'::vector, "
                f"'titan', 'text-embed-v2', 'v2')"
            ),
            {"t": tenant},
        )

        match = conn.execute(
            sa.text(
                "SELECT count(*) FROM chunks WHERE id = 'chk_fts' "
                "AND text_search @@ plainto_tsquery('english', 'refund')"
            )
        ).scalar()
        assert match == 1, "FTS generated column must match a relevant keyword query"

        no_match = conn.execute(
            sa.text(
                "SELECT count(*) FROM chunks WHERE id = 'chk_fts' "
                "AND text_search @@ plainto_tsquery('english', 'unrelated aardvark topic')"
            )
        ).scalar()
        assert no_match == 0


class TestDowngrade:
    def test_downgrade_removes_all_tables(self, pg_url: str) -> None:
        alembic_cfg = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        alembic_cfg.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        alembic_cfg.set_main_option("sqlalchemy.url", pg_url)

        command.downgrade(alembic_cfg, "base")

        engine = sa.create_engine(pg_url)
        with engine.connect() as c:
            for table in TABLES:
                result = c.execute(
                    sa.text(
                        "SELECT 1 FROM information_schema.tables "
                        "WHERE table_schema='public' AND table_name=:t"
                    ),
                    {"t": table},
                )
                assert result.scalar() is None, f"Table still exists after downgrade: {table}"
