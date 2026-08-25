"""Real-Postgres coverage for the performance_records writer.

Until this endpoint existed, performance_records had zero real writers
anywhere in the monorepo -- everything downstream (agent performance
reads, drift-candidate discovery, and the future draft-agent promotion
logic) was reading a table nothing ever populated.
"""

from collections.abc import AsyncGenerator, Generator
from pathlib import Path

import pytest
from alembic.config import Config as AlembicConfig
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.db.session import get_db_session
from src.main import app

SERVICE_ROOT = Path(__file__).parent.parent
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"

TENANT_A = "ten_018f47a5-7b2c-7d10-8f11-123456789abc"
WORKSPACE_A = "ws_018f47a5-7b2c-7d10-8f11-123456789abc"
RUN_ID = "run_018f47a5-7b2c-7d10-8f11-123456789abc"
AGENT_A = "agt_018f47a5-7b2c-7d10-8f11-123456789ab1"


def raw_id(prefixed_id: str) -> str:
    return prefixed_id.split("_", maxsplit=1)[1]


@pytest.fixture(scope="module")
def postgres_url() -> Generator[str, None, None]:
    with PostgresContainer(
        image=PGVECTOR_IMAGE,
        dbname="intelligence_db",
        username="intelligence_service",
        password="testpass",
    ) as postgres:
        sync_url = postgres.get_connection_url()
        alembic_config = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        alembic_config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        alembic_config.set_main_option("sqlalchemy.url", sync_url)
        command.upgrade(alembic_config, "head")
        yield sync_url


async def seed_agent(session: AsyncSession) -> None:
    tenant_uuid = raw_id(TENANT_A)
    await session.execute(
        text(
            """
INSERT INTO agents (id, tenant_id, workspace_id, name, tier, status)
VALUES (:agent_id, CAST(:tenant_id AS uuid), CAST(:workspace_id AS uuid),
        'Agent A', 'STANDARD', 'active')
ON CONFLICT (id) DO NOTHING
"""
        ),
        {"agent_id": AGENT_A, "tenant_id": tenant_uuid, "workspace_id": raw_id(WORKSPACE_A)},
    )
    await session.commit()


async def _seed_draft_agent(session: AsyncSession, agent_id: str) -> None:
    tenant_uuid = raw_id(TENANT_A)
    await session.execute(
        text(
            """
INSERT INTO agents (id, tenant_id, workspace_id, name, tier, status)
VALUES (:agent_id, CAST(:tenant_id AS uuid), CAST(:workspace_id AS uuid),
        'Agent Draft', 'STANDARD', 'draft')
ON CONFLICT (id) DO NOTHING
"""
        ),
        {"agent_id": agent_id, "tenant_id": tenant_uuid, "workspace_id": raw_id(WORKSPACE_A)},
    )
    await session.commit()


def seed(postgres_url: str) -> None:
    """Runs seeding on its own fresh event loop/connection -- kept fully
    separate from TestClient's own loop (see `client` fixture docstring in
    test_selection_binding_router.py, the precedent this mirrors)."""
    import asyncio

    async_url = make_url(postgres_url).set(drivername="postgresql+asyncpg")

    async def run() -> None:
        engine = create_async_engine(async_url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            await seed_agent(session)
        await engine.dispose()

    asyncio.run(run())


def seed_draft_agent(postgres_url: str, agent_id: str) -> None:
    """Each promotion test seeds its own distinct draft agent id -- the
    postgres_url container/fixture is module-scoped and shared across every
    test in this file, so reusing one draft agent id across tests that
    assert different post-promotion states would cross-contaminate."""
    import asyncio

    async_url = make_url(postgres_url).set(drivername="postgresql+asyncpg")

    async def run() -> None:
        engine = create_async_engine(async_url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            await _seed_draft_agent(session, agent_id)
        await engine.dispose()

    asyncio.run(run())


def read_agent_status(postgres_url: str, agent_id: str) -> str:
    import asyncio

    async_url = make_url(postgres_url).set(drivername="postgresql+asyncpg")

    async def run() -> str:
        engine = create_async_engine(async_url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            result = await session.execute(
                text("SELECT status FROM agents WHERE id = :agent_id"),
                {"agent_id": agent_id},
            )
            status = result.scalar_one()
        await engine.dispose()
        return str(status)

    return asyncio.run(run())


@pytest.fixture
def client(postgres_url: str) -> Generator[TestClient, None, None]:
    async_url = make_url(postgres_url).set(drivername="postgresql+asyncpg")

    async def override_session() -> AsyncGenerator[AsyncSession, None]:
        engine = create_async_engine(async_url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            yield session
        await engine.dispose()

    app.dependency_overrides[get_db_session] = override_session
    with TestClient(app, headers={"authorization": "Bearer integration-token"}) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def request_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "tenant_id": TENANT_A,
        "run_id": RUN_ID,
        "node_type": "LLMTask",
        "task_category": "analysis",
        "verdict": "success",
        "latency_ms": 1200,
        "token_count": 340,
    }
    body.update(overrides)
    return body


class TestRecordAgentPerformanceRoute:
    def test_records_a_real_observation_and_it_is_readable_afterward(
        self, postgres_url: str, client: TestClient
    ) -> None:
        seed(postgres_url)

        response = client.post(
            f"/internal/performance/agents/{AGENT_A}/records",
            json=request_body(),
            headers={"Authorization": "Bearer test-token"},
        )

        assert response.status_code == 201
        record_id = response.json()["id"]
        assert record_id.startswith("perf_")

        read = client.get(
            f"/internal/performance/agents/{AGENT_A}",
            params={"tenant_id": TENANT_A, "task_class": "analysis"},
            headers={"Authorization": "Bearer test-token"},
        )
        assert read.status_code == 200
        observations = read.json()["observations"]
        assert len(observations) == 1
        assert observations[0]["verdict"] == "success"
        assert observations[0]["latency_ms"] == 1200
        assert observations[0]["token_count"] == 340

    def test_rejects_an_unknown_agent_with_404_instead_of_an_orphan_row(
        self, postgres_url: str, client: TestClient
    ) -> None:
        seed(postgres_url)

        response = client.post(
            "/internal/performance/agents/agt_018f47a5-7b2c-7d10-8f11-99999999999a/records",
            json=request_body(),
            headers={"Authorization": "Bearer test-token"},
        )

        assert response.status_code == 404

    def test_requires_a_bearer_authorization_header(
        self, postgres_url: str, client: TestClient
    ) -> None:
        seed(postgres_url)

        response = client.post(
            f"/internal/performance/agents/{AGENT_A}/records",
            json=request_body(),
            headers={"Authorization": ""},
        )

        assert response.status_code == 401

    def test_rejects_a_malformed_tenant_id(self, postgres_url: str, client: TestClient) -> None:
        seed(postgres_url)

        response = client.post(
            f"/internal/performance/agents/{AGENT_A}/records",
            json=request_body(tenant_id="not-a-real-tenant-id"),
            headers={"Authorization": "Bearer test-token"},
        )

        assert response.status_code == 422

    def test_rejects_an_unrecognised_verdict(self, postgres_url: str, client: TestClient) -> None:
        seed(postgres_url)

        response = client.post(
            f"/internal/performance/agents/{AGENT_A}/records",
            json=request_body(verdict="not_a_real_verdict"),
            headers={"Authorization": "Bearer test-token"},
        )

        assert response.status_code == 422


class TestDraftAgentPromotion:
    """The real config.py default (draft_agent_promotion_threshold=3) is
    exercised directly here, not overridden -- these prove the actual
    production threshold, not a test-only stand-in. Each test seeds its own
    draft agent id since postgres_url's container is shared module-wide."""

    def test_promotes_a_draft_agent_to_active_after_the_real_success_threshold(
        self, postgres_url: str, client: TestClient
    ) -> None:
        agent_id = "agt_018f47a5-7b2c-7d10-8f11-1111111111a1"
        seed_draft_agent(postgres_url, agent_id)
        assert read_agent_status(postgres_url, agent_id) == "draft"

        for _ in range(3):
            response = client.post(
                f"/internal/performance/agents/{agent_id}/records",
                json=request_body(),
                headers={"Authorization": "Bearer test-token"},
            )
            assert response.status_code == 201

        assert read_agent_status(postgres_url, agent_id) == "active"

    def test_does_not_promote_a_draft_agent_below_the_success_threshold(
        self, postgres_url: str, client: TestClient
    ) -> None:
        agent_id = "agt_018f47a5-7b2c-7d10-8f11-2222222222a2"
        seed_draft_agent(postgres_url, agent_id)

        for _ in range(2):
            client.post(
                f"/internal/performance/agents/{agent_id}/records",
                json=request_body(),
                headers={"Authorization": "Bearer test-token"},
            )

        assert read_agent_status(postgres_url, agent_id) == "draft"

    def test_failure_verdicts_do_not_count_toward_promotion(
        self, postgres_url: str, client: TestClient
    ) -> None:
        agent_id = "agt_018f47a5-7b2c-7d10-8f11-3333333333a3"
        seed_draft_agent(postgres_url, agent_id)

        for _ in range(5):
            client.post(
                f"/internal/performance/agents/{agent_id}/records",
                json=request_body(verdict="failure"),
                headers={"Authorization": "Bearer test-token"},
            )

        assert read_agent_status(postgres_url, agent_id) == "draft"
