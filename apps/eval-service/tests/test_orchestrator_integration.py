"""Real end-to-end test for HARD-7: EvalRunOrchestrator against a real
Postgres eval_db and a real, live verification-service gRPC server (run as
a genuine separate process, its own venv, its own interpreter).

Both real dependencies -- nothing here is mocked. Verifies the actual
claim this ticket makes: the verification golden set's 20 real seeded
cases execute for real and produce a real, correct pass_rate.
"""

from __future__ import annotations

import os
import socket
import subprocess
import time
from collections.abc import Generator
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.execution.orchestrator import (
    EvalRunOrchestrator,
    GoldenSetNotFoundError,
    UnsupportedDomainError,
)
from src.execution.verification_client import VerificationClient

SERVICE_ROOT = Path(__file__).parent.parent
REPO_ROOT = SERVICE_ROOT.parents[1]


@pytest.fixture(scope="module")
def sessions() -> Generator[sessionmaker[Session], None, None]:
    with PostgresContainer(image="postgres:16-alpine", dbname="eval_db") as postgres:
        url = postgres.get_connection_url()
        config = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")

        engine = sa.create_engine(url)
        with engine.connect() as conn:
            conn.execute(sa.text("CREATE ROLE eval_service NOLOGIN"))
            conn.execute(sa.text("GRANT eval_service TO CURRENT_USER"))
            conn.execute(
                sa.text(
                    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public "
                    "TO eval_service"
                )
            )
            conn.commit()

        @event.listens_for(engine, "connect")
        def _set_service_context(dbapi_connection: object, _record: object) -> None:
            cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
            cursor.execute("SET ROLE eval_service")
            cursor.execute("SET app.eval_internal = 'on'")
            cursor.close()

        yield sessionmaker(bind=engine, expire_on_commit=False)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]  # type: ignore[no-any-return]


def _wait_for_port(port: int, timeout_seconds: float = 20.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.1)
    raise TimeoutError(f"verification-service did not bind port {port} in time")


@pytest.fixture(scope="module")
def verification_server_target() -> Generator[str, None, None]:
    """Real, live verification-service gRPC server, run as a real separate
    process (not an in-process import) -- both services use "src" as their
    top-level package name, which collides under a single Python
    interpreter's sys.path. A subprocess is also the real, honest shape:
    two separate deployed services talking over gRPC, not one process
    pretending to be two.

    ScoreNodeInline for deterministic/stub-reviewer node types never
    queries Postgres or calls Model Gateway (see grpc_service.py/kernel.py)
    -- the placeholder env vars below only need to be well-formed enough
    for the server to *start* (engine/channel creation is lazy), not real,
    connectable endpoints.
    """
    verification_root = REPO_ROOT / "apps" / "verification-service"
    verification_python = verification_root / ".venv" / "bin" / "python"
    if not verification_python.exists():
        pytest.skip(
            "apps/verification-service/.venv not present -- run `uv sync` there first "
            "(same real dependency this test always needed, just not eval-service's own venv)"
        )
    port = _free_port()
    process = subprocess.Popen(  # noqa: S603 -- fixed argv, no shell, test-only
        [str(verification_python), "-m", "src.grpc_server"],
        cwd=str(verification_root),
        env={
            "PATH": os.environ.get("PATH", ""),
            "ORCHESTRATION_DATABASE_URL": "postgresql+asyncpg://unused:unused@127.0.0.1:1/unused",
            "MODEL_GATEWAY_GRPC_TARGET": "127.0.0.1:1",
            "GRPC_BIND_ADDRESS": f"127.0.0.1:{port}",
        },
    )
    try:
        _wait_for_port(port)
        yield f"127.0.0.1:{port}"
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def test_verification_golden_set_executes_for_real_and_all_20_cases_pass(
    sessions: sessionmaker[Session],
    verification_server_target: str,
) -> None:
    client = VerificationClient(verification_server_target)
    orchestrator = EvalRunOrchestrator(sessions, client)

    try:
        summary = orchestrator.run("verification", trigger="manual")
    finally:
        client.close()

    assert summary.total_cases == 20
    assert summary.passed == 20
    assert summary.failed == 0
    assert summary.pass_rate == 1.0

    with sessions() as session:
        row = session.execute(
            sa.text("SELECT status, pass_rate FROM eval_runs WHERE id = :id"),
            {"id": str(summary.eval_run_id)},
        ).one()
        assert row.status == "completed"
        assert float(row.pass_rate) == 1.0

        result_count = session.execute(
            sa.text("SELECT count(*) FROM eval_results WHERE eval_run_id = :id"),
            {"id": str(summary.eval_run_id)},
        ).scalar_one()
        assert result_count == 20


def test_rerunning_produces_a_second_independent_real_eval_run(
    sessions: sessionmaker[Session],
    verification_server_target: str,
) -> None:
    client = VerificationClient(verification_server_target)
    orchestrator = EvalRunOrchestrator(sessions, client)
    try:
        first = orchestrator.run("verification")
        second = orchestrator.run("verification")
    finally:
        client.close()

    assert first.eval_run_id != second.eval_run_id
    assert first.pass_rate == second.pass_rate == 1.0


def test_unsupported_domain_is_rejected_not_silently_skipped(
    sessions: sessionmaker[Session],
    verification_server_target: str,
) -> None:
    client = VerificationClient(verification_server_target)
    orchestrator = EvalRunOrchestrator(sessions, client)
    try:
        with pytest.raises(UnsupportedDomainError):
            orchestrator.run("planner")
    finally:
        client.close()


def test_unknown_golden_set_raises(
    sessions: sessionmaker[Session],
    verification_server_target: str,
) -> None:
    client = VerificationClient(verification_server_target)
    orchestrator = EvalRunOrchestrator(sessions, client)
    try:
        with pytest.raises(GoldenSetNotFoundError):
            orchestrator.run("does-not-exist")
    finally:
        client.close()
