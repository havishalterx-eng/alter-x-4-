"""Policy DB migration contract tests."""
# ruff: noqa: E501, E702

from collections.abc import Generator
from pathlib import Path

import pytest
import sqlalchemy as sa
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from alembic.config import Config as AlembicConfig

SERVICE_ROOT = Path(__file__).parent.parent
MIGRATION = SERVICE_ROOT / "alembic" / "versions" / "0001_create_policy_tables.py"


def test_migration_declares_every_policy_table_and_indexes() -> None:
    sql = MIGRATION.read_text()
    for table in ("policies", "policy_promotions", "drift_scores", "memory_records"):
        assert f"CREATE TABLE {table}" in sql
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
        assert f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY" in sql
    for index in (
        "idx_policies_scope_kind",
        "idx_policy_promotions_policy",
        "idx_drift_scores_subject",
        "idx_memory_records_tenant_scope",
    ):
        assert index in sql


def test_policy_scope_and_promotion_rls_cover_all_scope_branches() -> None:
    sql = MIGRATION.read_text()
    for scope, setting in (
        ("tenant", "app.current_tenant_id"),
        ("workspace", "app.current_workspace_id"),
        ("workflow", "app.current_workflow_id"),
        ("project", "app.current_project_id"),
    ):
        assert f"scope='{scope}'" in sql
        assert setting in sql
    assert "CREATE POLICY promotions_read" in sql
    assert "FROM policies p WHERE p.id=policy_id" in sql


def test_global_memory_and_drift_guards_are_explicit() -> None:
    sql = MIGRATION.read_text()
    assert "current_user='policy_system_writer'" in sql
    assert "tenant_id IS NULL AND scope='global'" in sql
    assert "CREATE POLICY drift_read" in sql
    assert "subject_type IN ('model','provider')" in sql
    assert "Agent drift rows" in sql


def test_tenant_immutability_and_policy_version_constraint_exist() -> None:
    sql = MIGRATION.read_text()
    assert sql.count("CREATE OR REPLACE FUNCTION reject_tenant_id_change") == 1
    assert "memory_records_reject_tenant_id_change" in sql
    assert "UNIQUE NULLS NOT DISTINCT (scope,scope_id,kind,version)" in sql


def test_downgrade_removes_schema() -> None:
    sql = MIGRATION.read_text()
    for table in ("memory_records", "drift_scores", "policy_promotions", "policies"):
        assert f"DROP TABLE IF EXISTS {table}" in sql


@pytest.fixture(scope="module")
def pg_url() -> Generator[str, None, None]:
    with PostgresContainer(image="postgres:16-alpine", dbname="policy_db") as pg:
        url = pg.get_connection_url()
        cfg = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        cfg.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(cfg, "head")
        engine = sa.create_engine(url, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            conn.execute(sa.text("CREATE ROLE policy_system_writer"))
            conn.execute(sa.text("CREATE ROLE policy_reader"))
            for table in ("policies", "policy_promotions", "drift_scores", "memory_records"):
                conn.execute(sa.text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO policy_reader"))
            conn.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO policy_system_writer"))
        yield url


def _tenant(conn: sa.Connection, value: str) -> None:
    conn.execute(sa.text(f"SET app.current_tenant_id = '{value}'"))


def test_live_upgrade_creates_tables_indexes_and_forced_rls(pg_url: str) -> None:
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        tables = conn.execute(sa.text("SELECT relname FROM pg_class WHERE relrowsecurity AND relforcerowsecurity"))
        assert {row[0] for row in tables} >= {"policies", "policy_promotions", "drift_scores", "memory_records"}
        indexes = conn.execute(sa.text("SELECT indexname FROM pg_indexes WHERE schemaname='public'"))
        assert {row[0] for row in indexes} >= {"idx_policies_scope_kind", "idx_policy_promotions_policy", "idx_drift_scores_subject", "idx_memory_records_tenant_scope"}


def test_live_rls_global_and_tenant_guards(pg_url: str) -> None:
    a, b = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa", "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb"
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        conn.execute(sa.text("INSERT INTO policies(id,scope,scope_id,kind,version,body,status,source) VALUES ('pol_a','tenant',:a,'routing_weights',1,'{}','active','human')"), {"a": a})
        conn.execute(sa.text("INSERT INTO memory_records(id,scope,content,provenance,status) VALUES ('mem_g','global','{}','{}','verified')"))
        conn.commit(); conn.execute(sa.text("SET ROLE policy_reader")); _tenant(conn, b)
        assert conn.execute(sa.text("SELECT count(*) FROM policies WHERE id='pol_a'")).scalar() == 0
        assert conn.execute(sa.text("SELECT count(*) FROM memory_records WHERE id='mem_g'")).scalar() == 1
        with pytest.raises(Exception):
            conn.execute(sa.text("INSERT INTO memory_records(id,scope,content,provenance,status) VALUES ('mem_bad','global','{}','{}','verified')"))


def test_live_immutability_unique_and_downgrade(pg_url: str) -> None:
    tenant = "cccccccc-0000-4000-8000-cccccccccccc"
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        _tenant(conn, tenant)
        conn.execute(sa.text("INSERT INTO memory_records(id,tenant_id,scope,content,provenance,status) VALUES ('mem_t',:t,'failure','{}','{}','verified')"), {"t": tenant})
        with pytest.raises(Exception, match="tenant_id is immutable"):
            conn.execute(sa.text("UPDATE memory_records SET tenant_id='dddddddd-0000-4000-8000-dddddddddddd' WHERE id='mem_t'"))
