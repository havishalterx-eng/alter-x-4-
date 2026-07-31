"""Eval database migration and isolation contract tests."""

from collections.abc import Generator
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from testcontainers.community.postgres import PostgresContainer

from alembic import command

SERVICE_ROOT = Path(__file__).parent.parent
MIGRATION = SERVICE_ROOT / "alembic" / "versions" / "0001_create_eval_tables.py"
TABLES = (
    "golden_sets",
    "eval_cases",
    "eval_runs",
    "eval_results",
    "redteam_results",
    "release_gates",
)


def test_migration_declares_all_eval_tables_and_forced_rls() -> None:
    sql = MIGRATION.read_text()
    for table in TABLES:
        assert f'"{table}"' in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "current_user = 'eval_service'" in sql
    assert "app.eval_internal" in sql


@pytest.fixture(scope="module")
def pg_url() -> Generator[str, None, None]:
    with PostgresContainer(image="postgres:16-alpine", dbname="eval_db") as postgres:
        url = postgres.get_connection_url()
        config = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")

        engine = sa.create_engine(url, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            conn.execute(sa.text("CREATE ROLE eval_service NOLOGIN"))
            conn.execute(sa.text("CREATE ROLE eval_reader NOLOGIN"))
            conn.execute(sa.text("GRANT eval_service, eval_reader TO CURRENT_USER"))
            conn.execute(
                sa.text(
                    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public "
                    "TO eval_service, eval_reader"
                )
            )
        yield url


def _service_context(conn: sa.Connection) -> None:
    conn.execute(sa.text("SET ROLE eval_service"))
    conn.execute(sa.text("SET app.eval_internal = 'on'"))


def test_live_upgrade_creates_all_tables_relationships_and_indexes(pg_url: str) -> None:
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        tables = set(
            conn.execute(
                sa.text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            ).scalars()
        )
        assert set(TABLES) <= tables
        forced_rls = set(
            conn.execute(
                sa.text("SELECT relname FROM pg_class WHERE relrowsecurity AND relforcerowsecurity")
            ).scalars()
        )
        assert set(TABLES) <= forced_rls
        foreign_keys = set(
            conn.execute(
                sa.text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE contype = 'f' AND conrelid::regclass::text IN "
                    "('eval_cases', 'eval_runs', 'eval_results', 'release_gates')"
                )
            ).scalars()
        )
        assert len(foreign_keys) == 5


def test_live_schema_constraints_and_service_only_rls(pg_url: str) -> None:
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        _service_context(conn)
        golden_set_id = conn.execute(
            sa.text(
                "INSERT INTO golden_sets(name, domain, version) VALUES "
                "('planner-baseline', 'planner', 1) RETURNING id"
            )
        ).scalar_one()
        case_id = conn.execute(
            sa.text(
                "INSERT INTO eval_cases(golden_set_id, input, expected) VALUES "
                "(:set_id, '{}'::jsonb, '{}'::jsonb) RETURNING id"
            ),
            {"set_id": golden_set_id},
        ).scalar_one()
        run_id = conn.execute(
            sa.text(
                "INSERT INTO eval_runs(golden_set_id, golden_set_version, subject, trigger) VALUES "
                "(:set_id, 1, 'planner@1', 'pre_merge') RETURNING id"
            ),
            {"set_id": golden_set_id},
        ).scalar_one()
        conn.execute(
            sa.text(
                "INSERT INTO eval_results(eval_run_id, eval_case_id, verdict) VALUES "
                "(:run_id, :case_id, 'pass')"
            ),
            {"run_id": run_id, "case_id": case_id},
        )
        conn.commit()
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(
                sa.text(
                    "INSERT INTO eval_results(eval_run_id, eval_case_id, verdict) VALUES "
                    "(:run_id, :case_id, 'pass')"
                ),
                {"run_id": run_id, "case_id": case_id},
            )
        conn.rollback()

    with engine.connect() as conn:
        conn.execute(sa.text("SET ROLE eval_reader"))
        assert conn.execute(sa.text("SELECT count(*) FROM golden_sets")).scalar_one() == 0
        with pytest.raises(sa.exc.ProgrammingError):
            conn.execute(
                sa.text(
                    "INSERT INTO golden_sets(name, domain, version) VALUES "
                    "('reader-attempt', 'planner', 1)"
                )
            )
