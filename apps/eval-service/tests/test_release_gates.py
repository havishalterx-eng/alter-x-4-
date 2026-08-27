"""Direct unit coverage for ReleaseGateRecorder.record() -- the mechanism
that decides whether a release is approved or blocked from an eval run's
pass rate. test_eval_grpc_transport.py already proves the blocked path
end-to-end through the gRPC transport (a zero-case golden set); this file
exercises the recorder in isolation for speed and precision, and adds the
approved decision and the error paths that had no coverage at all.
"""

from __future__ import annotations

from collections.abc import Generator
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from docker.errors import DockerException  # type: ignore[import-untyped]
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.db.models import EvalRun, GoldenSet, ReleaseGate
from src.release_gates import ReleaseGateRecorder


@pytest.fixture()
def sessions() -> Generator[sessionmaker[Session], None, None]:
    # Narrower copy of test_eval_grpc_transport.py's own `sessions` fixture:
    # same real Testcontainers Postgres + real Alembic migrations + the
    # eval_service role/RLS setup (release_gates, eval_runs, and golden_sets
    # all FORCE ROW LEVEL SECURITY with a policy that requires
    # current_user = 'eval_service' AND app.eval_internal = 'on' -- see
    # 0001_create_eval_tables.py -- so this role dance isn't optional
    # scaffolding, it's required for any row to be visible at all), just
    # without the gRPC server/client machinery this file doesn't need.
    try:
        with PostgresContainer(image="postgres:16-alpine", dbname="eval_db") as postgres:
            url = postgres.get_connection_url()
            service_root = Path(__file__).parent.parent
            alembic_config = AlembicConfig(str(service_root / "alembic.ini"))
            alembic_config.set_main_option("script_location", str(service_root / "alembic"))
            alembic_config.set_main_option("sqlalchemy.url", url)
            command.upgrade(alembic_config, "head")

            engine = sa.create_engine(url)
            with engine.connect() as connection:
                connection.execute(sa.text("CREATE ROLE eval_service NOLOGIN"))
                connection.execute(sa.text("GRANT eval_service TO CURRENT_USER"))
                connection.execute(
                    sa.text(
                        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public "
                        "TO eval_service"
                    )
                )
                connection.commit()

            @event.listens_for(engine, "connect")
            def _set_service_context(dbapi_connection: object, _record: object) -> None:
                cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
                cursor.execute("SET ROLE eval_service")
                cursor.execute("SET app.eval_internal = 'on'")
                cursor.close()

            yield sessionmaker(bind=engine, expire_on_commit=False)
            engine.dispose()
    except DockerException as error:
        pytest.skip(f"Docker is unavailable for the real release gates test: {error}")


def _insert_eval_run(
    sessions: sessionmaker[Session],
    *,
    status: str,
    pass_rate: float | None,
) -> UUID:
    golden_set_id = uuid4()
    eval_run_id = uuid4()
    # Two separate commits, not one: EvalRun.golden_set_id has a real FK to
    # golden_sets.id but no declared ORM relationship() between the two
    # models, so the unit of work has nothing to order the inserts by
    # within a single flush -- a real ForeignKeyViolation, not a
    # theoretical one (caught by CI's Postgres). Committing the GoldenSet
    # first removes the ordering question entirely.
    with sessions.begin() as session:
        session.add(
            GoldenSet(
                id=golden_set_id,
                name=f"release-gates-{eval_run_id}",
                domain="verification",
                version=1,
                status="active",
            )
        )
    with sessions.begin() as session:
        session.add(
            EvalRun(
                id=eval_run_id,
                golden_set_id=golden_set_id,
                golden_set_version=1,
                subject="engine",
                trigger="manual",
                status=status,
                pass_rate=pass_rate,
            )
        )
    return eval_run_id


def _recorded_decision(sessions: sessionmaker[Session], eval_run_id: UUID) -> str:
    with sessions.begin() as session:
        gate = session.scalar(sa.select(ReleaseGate).where(ReleaseGate.eval_run_id == eval_run_id))
    assert gate is not None
    return gate.decision


def test_approves_a_completed_run_at_the_minimum_pass_rate(
    sessions: sessionmaker[Session],
) -> None:
    eval_run_id = _insert_eval_run(sessions, status="completed", pass_rate=1.0)
    recorder = ReleaseGateRecorder(sessions)

    result = recorder.record(subject="engine", eval_run_id=eval_run_id, decided_by="qa-bot")

    assert result.decision == "approved"
    assert result.subject == "engine"
    assert result.eval_run_id == eval_run_id
    assert result.decided_by == "qa-bot"
    assert _recorded_decision(sessions, eval_run_id) == "approved"


def test_blocks_a_completed_run_below_the_minimum_pass_rate(
    sessions: sessionmaker[Session],
) -> None:
    eval_run_id = _insert_eval_run(sessions, status="completed", pass_rate=0.5)
    recorder = ReleaseGateRecorder(sessions)

    result = recorder.record(subject="engine", eval_run_id=eval_run_id, decided_by=None)

    assert result.decision == "blocked"
    assert _recorded_decision(sessions, eval_run_id) == "blocked"


def test_default_minimum_pass_rate_is_a_strict_100_percent_boundary(
    sessions: sessionmaker[Session],
) -> None:
    recorder = ReleaseGateRecorder(sessions)

    exactly_full = _insert_eval_run(sessions, status="completed", pass_rate=1.0)
    assert (
        recorder.record(subject="engine", eval_run_id=exactly_full, decided_by=None).decision
        == "approved"
    )

    just_under = _insert_eval_run(sessions, status="completed", pass_rate=0.99)
    assert (
        recorder.record(subject="engine", eval_run_id=just_under, decided_by=None).decision
        == "blocked"
    )


def test_a_custom_lower_minimum_pass_rate_actually_changes_the_decision(
    sessions: sessionmaker[Session],
) -> None:
    # 0.85 would be blocked under the default recorder (proven above by the
    # 0.99-is-blocked case) -- constructing with a real, lower
    # minimum_pass_rate is what makes it approved here.
    recorder = ReleaseGateRecorder(sessions, minimum_pass_rate=Decimal("0.8"))

    at_threshold = _insert_eval_run(sessions, status="completed", pass_rate=0.8)
    assert (
        recorder.record(subject="engine", eval_run_id=at_threshold, decided_by=None).decision
        == "approved"
    )

    above_threshold = _insert_eval_run(sessions, status="completed", pass_rate=0.85)
    assert (
        recorder.record(subject="engine", eval_run_id=above_threshold, decided_by=None).decision
        == "approved"
    )


def test_raises_lookup_error_for_an_eval_run_that_does_not_exist(
    sessions: sessionmaker[Session],
) -> None:
    missing_id = uuid4()
    recorder = ReleaseGateRecorder(sessions)

    with pytest.raises(LookupError, match=str(missing_id)):
        recorder.record(subject="engine", eval_run_id=missing_id, decided_by=None)


def test_raises_value_error_for_a_run_that_is_not_yet_completed(
    sessions: sessionmaker[Session],
) -> None:
    eval_run_id = _insert_eval_run(sessions, status="running", pass_rate=None)
    recorder = ReleaseGateRecorder(sessions)

    with pytest.raises(ValueError, match="completed eval run with a pass rate"):
        recorder.record(subject="engine", eval_run_id=eval_run_id, decided_by=None)


def test_raises_value_error_for_a_completed_run_with_no_pass_rate(
    sessions: sessionmaker[Session],
) -> None:
    # Distinct from the "not yet completed" case above: status IS
    # "completed" here, so this exercises the `run.pass_rate is None` half
    # of the guard's `or` condition specifically, not the status half.
    eval_run_id = _insert_eval_run(sessions, status="completed", pass_rate=None)
    recorder = ReleaseGateRecorder(sessions)

    with pytest.raises(ValueError, match="completed eval run with a pass rate"):
        recorder.record(subject="engine", eval_run_id=eval_run_id, decided_by=None)


@pytest.mark.parametrize("bad_minimum", [Decimal("1.5"), Decimal("-0.1")])
def test_constructor_rejects_a_minimum_pass_rate_outside_zero_to_one(
    sessions: sessionmaker[Session], bad_minimum: Decimal
) -> None:
    with pytest.raises(ValueError, match="minimum_pass_rate must be between 0 and 1"):
        ReleaseGateRecorder(sessions, minimum_pass_rate=bad_minimum)
