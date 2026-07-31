"""Eval database migration and isolation contract tests."""

from collections.abc import Generator
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.db.chaos_scenarios import CHAOS_GOLDEN_SET
from src.db.launch_golden_sets import LAUNCH_GOLDEN_SETS, case_id
from src.db.redteam_suites import REDTEAM_GOLDEN_SETS
from src.db.remaining_golden_sets import REMAINING_GOLDEN_SETS
from src.hardening import MockHarness, RegressionCapturePipeline, SqlAlchemyRegressionCaseStore
from src.release_gates import ReleaseGateRecorder

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

LAUNCH_FLOOR_COUNTS = {
    "planner": 20,
    "intent": 30,
    "retrieval": 20,
    "verification": 20,
    "recovery": 15,
    "injection": 25,
    "tenant-isolation": 20,
    "workflow E2E": 5,
    "project E2E": 3,
}

ALL_LAUNCH_GOLDEN_SETS = (*LAUNCH_GOLDEN_SETS, *REMAINING_GOLDEN_SETS)


def test_migration_declares_all_eval_tables_and_forced_rls() -> None:
    sql = MIGRATION.read_text()
    for table in TABLES:
        assert f'"{table}"' in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "current_user = 'eval_service'" in sql
    assert "app.eval_internal" in sql


def test_launch_floor_catalog_has_exact_counts_and_repeatable_ids() -> None:
    assert {golden_set.name: len(golden_set.cases) for golden_set in ALL_LAUNCH_GOLDEN_SETS} == (
        LAUNCH_FLOOR_COUNTS
    )
    assert sum(len(golden_set.cases) for golden_set in ALL_LAUNCH_GOLDEN_SETS) == 158

    ids = {
        case_id(golden_set, position)
        for golden_set in ALL_LAUNCH_GOLDEN_SETS
        for position, _case in enumerate(golden_set.cases, start=1)
    }
    assert len(ids) == 158
    for golden_set in ALL_LAUNCH_GOLDEN_SETS:
        assert golden_set.version == 1
        for case in golden_set.cases:
            assert case.input_json
            assert case.expected_json
            assert case.scoring["matcher"]
            assert "launch-floor" in case.tags


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


def test_live_launch_floor_sets_are_seeded_and_readable_by_eval_service(pg_url: str) -> None:
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        _service_context(conn)
        rows = conn.execute(
            sa.text(
                "SELECT golden_sets.name, count(eval_cases.id) "
                "FROM golden_sets LEFT JOIN eval_cases "
                "ON eval_cases.golden_set_id = golden_sets.id "
                "WHERE golden_sets.name IN ("
                "'planner', 'intent', 'retrieval', 'verification', 'recovery', 'injection', "
                "'tenant-isolation', 'workflow E2E', 'project E2E') "
                "GROUP BY golden_sets.name"
            )
        ).all()
        assert {str(name): int(count) for name, count in rows} == LAUNCH_FLOOR_COUNTS

        seed_case = (
            conn.execute(
                sa.text(
                    "SELECT input, expected, scoring, tags FROM eval_cases "
                    "JOIN golden_sets ON golden_sets.id = eval_cases.golden_set_id "
                    "WHERE golden_sets.name = 'planner' AND eval_cases.id = :case_id"
                ),
                {"case_id": case_id(LAUNCH_GOLDEN_SETS[0], 1)},
            )
            .mappings()
            .one()
        )
        assert seed_case["input"]["operation"] == "select_strategy"
        assert seed_case["expected"]["strategy"] == "direct"
        assert seed_case["scoring"]["matcher"] == "exact_json"
        assert "launch-floor" in seed_case["tags"]

        recovery_case = (
            conn.execute(
                sa.text(
                    "SELECT input, expected, tags FROM eval_cases "
                    "JOIN golden_sets ON golden_sets.id = eval_cases.golden_set_id "
                    "WHERE golden_sets.name = 'recovery' AND eval_cases.id = :case_id"
                ),
                {"case_id": case_id(REMAINING_GOLDEN_SETS[0], 1)},
            )
            .mappings()
            .one()
        )
        assert recovery_case["input"]["failure_class"] == "safety_violation"
        assert recovery_case["expected"]["strategy"] == "ask_user"
        assert "recovery" in recovery_case["tags"]


def test_live_failing_case_is_persisted_once_as_a_regression_case(pg_url: str) -> None:
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        _service_context(conn)
        store = SqlAlchemyRegressionCaseStore(sessionmaker(bind=conn, class_=Session))
        pipeline = RegressionCapturePipeline(store)
        source_case = LAUNCH_GOLDEN_SETS[0].cases[0]
        source_case_id = case_id(LAUNCH_GOLDEN_SETS[0], 1)
        failed = MockHarness().evaluate(source_case, {"strategy": "manager_worker"})

        first = pipeline.capture(source_case_id, failed)
        second = pipeline.capture(source_case_id, failed)

        assert first is not None and first.created is True
        assert second is not None and second.created is False
        stored = (
            conn.execute(
                sa.text("SELECT scoring, tags FROM eval_cases WHERE id = :case_id"),
                {"case_id": first.regression_case_id},
            )
            .mappings()
            .one()
        )
        regression = stored["scoring"]["regression"]
        assert isinstance(regression, dict)
        assert regression["source_case_id"] == str(source_case_id)
        assert "regression" in stored["tags"]


def test_live_redteam_suites_are_seeded_and_readable_by_eval_service(pg_url: str) -> None:
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        _service_context(conn)
        rows = conn.execute(
            sa.text(
                "SELECT golden_sets.name, count(eval_cases.id) "
                "FROM golden_sets LEFT JOIN eval_cases "
                "ON eval_cases.golden_set_id = golden_sets.id "
                "WHERE golden_sets.name IN "
                "('redteam-prompt-injection', 'redteam-jailbreak', 'redteam-ssrf', "
                "'redteam-malicious-upload', 'redteam-cross-tenant-leakage') "
                "GROUP BY golden_sets.name"
            )
        ).all()
        assert {str(name): int(count) for name, count in rows} == {
            golden_set.name: len(golden_set.cases) for golden_set in REDTEAM_GOLDEN_SETS
        }

        ssrf_case = (
            conn.execute(
                sa.text("SELECT input, expected, tags FROM eval_cases WHERE id = :case_id"),
                {"case_id": case_id(REDTEAM_GOLDEN_SETS[2], 1)},
            )
            .mappings()
            .one()
        )
        assert ssrf_case["input"]["attack"] == "ssrf"
        assert ssrf_case["expected"]["outcome"] == "blocked"
        assert "redteam" in ssrf_case["tags"]


def test_live_chaos_scenarios_are_seeded_and_readable_by_eval_service(pg_url: str) -> None:
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        _service_context(conn)
        rows = conn.execute(
            sa.text(
                "SELECT eval_cases.input, eval_cases.expected, eval_cases.tags "
                "FROM eval_cases JOIN golden_sets ON golden_sets.id = eval_cases.golden_set_id "
                "WHERE golden_sets.name = 'chaos' ORDER BY eval_cases.id"
            )
        ).mappings().all()
        assert len(rows) == len(CHAOS_GOLDEN_SET.cases) == 15
        assert {row["input"]["boundary"] for row in rows} >= {
            "orchestration",
            "model-gateway",
            "sandbox",
            "verification",
            "external-provider",
        }
        assert all(row["input"]["operation"] == "chaos_inject" for row in rows)
        assert all("chaos" in row["tags"] for row in rows)


def test_live_release_gate_is_derived_from_completed_eval_run(pg_url: str) -> None:
    engine = sa.create_engine(pg_url)
    with engine.connect() as conn:
        _service_context(conn)
        golden_set_id = conn.execute(
            sa.text(
                "INSERT INTO golden_sets(name, domain, version) VALUES "
                "('release-gate-test', 'hardening', 1) RETURNING id"
            )
        ).scalar_one()
        approved_run_id = conn.execute(
            sa.text(
                "INSERT INTO eval_runs(golden_set_id, golden_set_version, subject, trigger, "
                "status, pass_rate, started_at, completed_at) VALUES "
                "(:set_id, 1, 'engine@candidate', 'pre_merge', 'completed', 1, now(), now()) "
                "RETURNING id"
            ),
            {"set_id": golden_set_id},
        ).scalar_one()
        blocked_run_id = conn.execute(
            sa.text(
                "INSERT INTO eval_runs(golden_set_id, golden_set_version, subject, trigger, "
                "status, pass_rate, started_at, completed_at) VALUES "
                "(:set_id, 1, 'engine@candidate', 'pre_merge', 'completed', 0.8, now(), now()) "
                "RETURNING id"
            ),
            {"set_id": golden_set_id},
        ).scalar_one()

        recorder = ReleaseGateRecorder(sessionmaker(bind=conn, class_=Session))
        approved = recorder.record(
            subject="engine@candidate", eval_run_id=approved_run_id, decided_by="ci"
        )
        blocked = recorder.record(
            subject="engine@candidate", eval_run_id=blocked_run_id, decided_by="ci"
        )

        assert approved.decision == "approved"
        assert blocked.decision == "blocked"
        records = (
            conn.execute(
                sa.text(
                    "SELECT eval_run_id, decision, decided_by FROM release_gates "
                    "ORDER BY created_at"
                )
            )
            .mappings()
            .all()
        )
        assert {(row["eval_run_id"], row["decision"], row["decided_by"]) for row in records} >= {
            (approved_run_id, "approved", "ci"),
            (blocked_run_id, "blocked", "ci"),
        }
