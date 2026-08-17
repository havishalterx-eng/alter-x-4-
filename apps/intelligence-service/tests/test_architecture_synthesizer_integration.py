"""Real Registry-backed HTTP coverage for Architecture Synthesizer."""

import asyncio
from collections.abc import AsyncGenerator, Generator
from pathlib import Path

import pytest
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.architecture_synthesizer.router import router
from src.capability_registry.models import RegisterCapability
from src.capability_registry.repository import CapabilityRegistryRepository
from src.capability_resolver.resolver import resolve_node_requirements
from src.db.session import get_db_session
from src.planner.task_skeleton import TaskNode, TaskSkeleton

SERVICE_ROOT = Path(__file__).parent.parent
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"
TENANT_A = "ten_aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa"
TENANT_B = "ten_bbbbbbbb-0000-7000-8000-bbbbbbbbbbbb"
WORKSPACE_A = "ws_cccccccc-0000-7000-8000-cccccccccccc"
WORKSPACE_B = "ws_dddddddd-0000-7000-8000-dddddddddddd"


@pytest.fixture(scope="module")
def postgres_url() -> Generator[str, None, None]:
    with PostgresContainer(
        image=PGVECTOR_IMAGE,
        dbname="intelligence_db",
        username="intelligence_service",
        password="testpass",
    ) as postgres:
        url = postgres.get_connection_url()
        config = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")
        yield url


def register(postgres_url: str, tenant_id: str, **values: object) -> None:
    async_url = make_url(postgres_url).set(drivername="postgresql+asyncpg")

    async def run() -> None:
        engine = create_async_engine(async_url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            await CapabilityRegistryRepository(session).register(
                tenant_id,
                RegisterCapability.model_validate(values),
            )
        await engine.dispose()

    asyncio.run(run())


@pytest.fixture
def client(postgres_url: str) -> Generator[TestClient, None, None]:
    app = FastAPI()
    app.include_router(router)
    async_url = make_url(postgres_url).set(drivername="postgresql+asyncpg")

    async def override_session() -> AsyncGenerator[AsyncSession, None]:
        engine = create_async_engine(async_url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            yield session
        await engine.dispose()

    app.dependency_overrides[get_db_session] = override_session
    with TestClient(app) as test_client:
        yield test_client


def planner_resolver_payload(capability: str = "execution.run") -> dict[str, object]:
    skeleton = TaskSkeleton(
        nodes=[
            TaskNode(key="plan", type="llm"),
            TaskNode(key="execute", type="tool", depends_on=["plan"]),
        ],
        entry_point="plan",
    )
    requirements = resolve_node_requirements(
        [
            {"key": "plan", "type": "LLMTask", "config": {}, "metadata": {"ui": {}}},
            {
                "key": "execute",
                "type": "ToolCall",
                "config": {"tool_name": "run", "permissions": [], "capabilities": [capability]},
                "metadata": {"ui": {}}},
        ]
    )
    return {
        "tenant_id": TENANT_A,
        "workspace_id": WORKSPACE_A,
        "task_skeleton": skeleton.model_dump(),
        "node_requirements": requirements.model_dump(exclude_none=True),
    }


def test_router_uses_tenant_workspace_visible_registry_facts(
    client: TestClient, postgres_url: str
) -> None:
    register(
        postgres_url,
        TENANT_B,
        capability_id="foreign-only",
        kind="model",
        scope="tenant",
        supported_capabilities=["text.generation"],
        provenance={"source": "test"},
    )
    register(
        postgres_url,
        TENANT_B,
        capability_id="foreign-tool",
        kind="tool",
        scope="tenant",
        supported_capabilities=["execution.run"],
        provenance={"source": "test"},
    )
    blocked = client.post(
        "/internal/architecture-synthesis/synthesize", json=planner_resolver_payload()
    )
    assert blocked.status_code == 200
    assert blocked.json()["status"] == "blocked"

    register(
        postgres_url,
        TENANT_A,
        capability_id="tenant-model",
        kind="model",
        scope="workspace",
        workspace_id=WORKSPACE_A,
        supported_capabilities=["text.generation"],
        provenance={"source": "test"},
    )
    register(
        postgres_url,
        TENANT_A,
        capability_id="tenant-tool",
        kind="tool",
        scope="workspace",
        workspace_id=WORKSPACE_A,
        supported_capabilities=["execution.run"],
        provenance={"source": "test"},
    )
    response = client.post(
        "/internal/architecture-synthesis/synthesize", json=planner_resolver_payload()
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["topology"] == "sequential"
    assert [node["source_node_key"] for node in payload["nodes"]] == ["execute", "plan"]
    assert "tenant-model" not in response.text
    assert "tenant-tool" not in response.text

    wrong_workspace = planner_resolver_payload()
    wrong_workspace["workspace_id"] = WORKSPACE_B
    workspace_blocked = client.post(
        "/internal/architecture-synthesis/synthesize", json=wrong_workspace
    )
    assert workspace_blocked.json()["status"] == "blocked"
