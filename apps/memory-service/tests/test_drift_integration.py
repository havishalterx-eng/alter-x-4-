from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import time
from collections.abc import Generator, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.drift.detector import DriftDetector
from src.drift.intelligence_client import HttpxIntelligencePerformanceClient
from src.drift.models import (
    ComputeAgentDriftRequest,
    ComputeAgentDriftResponse,
    ListAgentDriftRequest,
)
from src.drift.repository import SqlAlchemyDriftRepository

MEMORY_ROOT = Path(__file__).parent.parent
INTELLIGENCE_ROOT = MEMORY_ROOT.parent / "intelligence-service"
TENANT_UUID = "038f4d6e-2b4a-7a3e-8c1a-1234567890ab"
TENANT_ID = f"ten_{TENANT_UUID}"
OTHER_TENANT_ID = "ten_048f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE_UUID = "038f4d6e-2b4a-7a3e-8c1a-1234567890ac"
DRIFTED_AGENT_ID = "agt_038f4d6e-2b4a-7a3e-8c1a-1234567890ad"
STABLE_AGENT_ID = "agt_038f4d6e-2b4a-7a3e-8c1a-1234567890ae"
TASK_CLASS = "analysis"
SYSTEM_PASSWORD = "know15-system-test-only"
TENANT_ROLE = "know15_tenant_writer"
TENANT_PASSWORD = "know15-tenant-test-only"


def _free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _migrate(service_root: Path, url: str) -> None:
    config = AlembicConfig(str(service_root / "alembic.ini"))
    config.set_main_option("script_location", str(service_root / "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "head")


def _role_url(url: str, username: str, password: str) -> str:
    return make_url(url).set(username=username, password=password).render_as_string(
        hide_password=False
    )


def _async_url(url: str) -> str:
    return make_url(url).set(drivername="postgresql+asyncpg").render_as_string(
        hide_password=False
    )


def _seed_agent_performance(
    url: str,
    *,
    agent_id: str,
    baseline: Sequence[str],
    recent: Sequence[str],
) -> None:
    engine = sa.create_engine(url)
    now = datetime.now(UTC)
    observations = [*baseline, *recent]
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                """
INSERT INTO agents(id,tenant_id,workspace_id,name,tier,status)
VALUES (:agent,CAST(:tenant AS uuid),CAST(:workspace AS uuid),:name,'STANDARD','active')
"""
            ),
            {
                "agent": agent_id,
                "tenant": TENANT_UUID,
                "workspace": WORKSPACE_UUID,
                "name": f"Agent {agent_id[-1]}",
            },
        )
        for index, verdict in enumerate(observations):
            connection.execute(
                sa.text(
                    """
INSERT INTO performance_records(
  id,agent_id,tenant_id,run_id,node_type,task_category,verdict,recorded_at
)
VALUES (
  :id,:agent,CAST(:tenant AS uuid),:run_id,'LLMTask',:task_class,:verdict,:recorded_at
)
"""
                ),
                {
                    "id": f"perf-{agent_id}-{index}",
                    "agent": agent_id,
                    "tenant": TENANT_UUID,
                    "run_id": f"run-seeded-{index}",
                    "task_class": TASK_CLASS,
                    "verdict": verdict,
                    "recorded_at": now - timedelta(minutes=len(observations) - index),
                },
            )
    engine.dispose()


@pytest.fixture(scope="module")
def drift_stack() -> Generator[dict[str, str], None, None]:
    with (
        PostgresContainer(
            image="pgvector/pgvector:pg16",
            dbname="intelligence_db",
            username="intelligence_service",
            password="testpass",
        ) as intelligence_postgres,
        PostgresContainer(
            image="postgres:16-alpine", dbname="policy_db"
        ) as policy_postgres,
    ):
        intelligence_url = intelligence_postgres.get_connection_url()
        policy_admin_url = policy_postgres.get_connection_url()
        _migrate(INTELLIGENCE_ROOT, intelligence_url)
        _migrate(MEMORY_ROOT, policy_admin_url)
        _seed_agent_performance(
            intelligence_url,
            agent_id=DRIFTED_AGENT_ID,
            baseline=("success", "success", "success", "success"),
            recent=("failure", "failure", "failure", "failure"),
        )
        _seed_agent_performance(
            intelligence_url,
            agent_id=STABLE_AGENT_ID,
            baseline=("success", "success", "success", "failure"),
            recent=("success", "success", "success", "failure"),
        )

        policy_admin = sa.create_engine(policy_admin_url, isolation_level="AUTOCOMMIT")
        with policy_admin.connect() as connection:
            connection.execute(
                sa.text(
                    "CREATE ROLE policy_system_writer LOGIN PASSWORD "
                    f"'{SYSTEM_PASSWORD}'"
                )
            )
            connection.execute(
                sa.text("GRANT CONNECT ON DATABASE policy_db TO policy_system_writer")
            )
            connection.execute(
                sa.text("GRANT USAGE ON SCHEMA public TO policy_system_writer")
            )
            connection.execute(
                sa.text(
                    "GRANT SELECT, INSERT ON drift_scores TO policy_system_writer"
                )
            )
            connection.execute(
                sa.text(f"CREATE ROLE {TENANT_ROLE} LOGIN PASSWORD '{TENANT_PASSWORD}'")
            )
            connection.execute(
                sa.text(f"GRANT CONNECT ON DATABASE policy_db TO {TENANT_ROLE}")
            )
            connection.execute(sa.text(f"GRANT USAGE ON SCHEMA public TO {TENANT_ROLE}"))
            connection.execute(
                sa.text(f"GRANT SELECT ON drift_scores TO {TENANT_ROLE}")
            )
        policy_admin.dispose()

        port = _free_port()
        environment = os.environ.copy()
        environment["INTELLIGENCE_DB_URL"] = _async_url(intelligence_url)
        environment["INTELLIGENCE_DB_URL_SYNC"] = intelligence_url
        process = subprocess.Popen(
            [
                "uv",
                "run",
                "--frozen",
                "uvicorn",
                "src.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=INTELLIGENCE_ROOT,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        base_url = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout is not None else ""
                raise RuntimeError(f"intelligence-service exited during startup: {output}")
            try:
                if httpx.get(f"{base_url}/health", timeout=0.5).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)
        else:
            process.terminate()
            output, _ = process.communicate(timeout=5)
            raise RuntimeError(f"intelligence-service failed to become healthy: {output}")

        try:
            yield {
                "intelligence_base_url": base_url,
                "policy_admin_url": policy_admin_url,
                "policy_system_url": _role_url(
                    policy_admin_url, "policy_system_writer", SYSTEM_PASSWORD
                ),
                "policy_tenant_url": _role_url(
                    policy_admin_url, TENANT_ROLE, TENANT_PASSWORD
                ),
            }
        finally:
            process.terminate()
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=5)


def test_real_performance_http_projection_computes_and_persists_drift(
    drift_stack: dict[str, str],
) -> None:
    cross_tenant = httpx.get(
        f"{drift_stack['intelligence_base_url']}/internal/performance/agents/"
        f"{DRIFTED_AGENT_ID}",
        params={"tenant_id": OTHER_TENANT_ID, "task_class": TASK_CLASS, "limit": 8},
        headers={"authorization": "Bearer integration-token"},
        timeout=5,
    )
    assert cross_tenant.status_code == 200
    assert cross_tenant.json()["observations"] == []

    system_engine = sa.create_engine(drift_stack["policy_system_url"])
    tenant_engine = sa.create_engine(drift_stack["policy_tenant_url"])
    repository = SqlAlchemyDriftRepository(
        sessionmaker(tenant_engine, class_=Session, expire_on_commit=False),
        sessionmaker(system_engine, class_=Session, expire_on_commit=False),
    )

    async def compute() -> tuple[ComputeAgentDriftResponse, ComputeAgentDriftResponse]:
        client = HttpxIntelligencePerformanceClient(
            drift_stack["intelligence_base_url"], timeout_seconds=5
        )
        detector = DriftDetector(
            client,
            repository,
            window_size=4,
            failure_threshold=0.2,
        )
        try:
            drifted = await detector.compute_agent_drift(
                ComputeAgentDriftRequest(
                    tenant_id=TENANT_ID,
                    agent_id=DRIFTED_AGENT_ID,
                    task_class=TASK_CLASS,
                ),
                "Bearer integration-token",
            )
            stable = await detector.compute_agent_drift(
                ComputeAgentDriftRequest(
                    tenant_id=TENANT_ID,
                    agent_id=STABLE_AGENT_ID,
                    task_class=TASK_CLASS,
                ),
                "Bearer integration-token",
            )
            return drifted, stable
        finally:
            await client.close()

    drifted, stable = asyncio.run(compute())
    assert drifted.score == 1.0
    assert drifted.baseline == 0.0
    assert drifted.action_taken == "flagged"
    assert stable.score == 0.0
    assert stable.action_taken == "none"

    async def list_scores(tenant_id: str) -> tuple[str, ...]:
        client = HttpxIntelligencePerformanceClient(
            drift_stack["intelligence_base_url"], timeout_seconds=5
        )
        detector = DriftDetector(client, repository, window_size=4, failure_threshold=0.2)
        try:
            response = await detector.list_agent_drift(
                ListAgentDriftRequest(tenant_id=tenant_id, agent_id=DRIFTED_AGENT_ID),
                "Bearer integration-token",
            )
            return tuple(score.drift_score_id for score in response.scores)
        finally:
            await client.close()

    cross_tenant_scores = asyncio.run(list_scores(OTHER_TENANT_ID))
    same_tenant_scores = asyncio.run(list_scores(TENANT_ID))
    tenant_engine.dispose()
    assert cross_tenant_scores == ()
    assert same_tenant_scores == ()

    admin = sa.create_engine(drift_stack["policy_admin_url"])
    with admin.connect() as connection:
        rows = connection.execute(
            sa.text(
                "SELECT subject_type,subject_ref,task_class,score,baseline,\"window\",action_taken "
                "FROM drift_scores ORDER BY subject_ref"
            )
        ).mappings().all()
    admin.dispose()
    system_engine.dispose()
    assert len(rows) == 2
    assert {row["action_taken"] for row in rows} == {"flagged", "none"}
    assert all(row["action_taken"] != "weight_decay" for row in rows)
    drifted_row = next(row for row in rows if row["subject_ref"] == DRIFTED_AGENT_ID)
    assert drifted_row["subject_type"] == "agent"
    assert drifted_row["task_class"] == TASK_CLASS
    assert float(drifted_row["score"]) == 1.0
    assert drifted_row["window"]["formula"] == (
        "max(0,recent_failure_rate-baseline_failure_rate)"
    )
