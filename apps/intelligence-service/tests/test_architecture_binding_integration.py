"""Real Postgres HTTP coverage for ArchitectureSpec Registry bindings."""

import asyncio
from collections.abc import AsyncGenerator, Generator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from alembic.config import Config as AlembicConfig
from src.architecture_synthesizer.models import (
    ArchitectureNode,
    ArchitectureSpec,
    EligibleCapabilityRole,
    ExecutionWave,
    SynthesisConstraints,
)
from src.capability_registry.models import RegisterCapability
from src.capability_registry.repository import CapabilityRegistryRepository
from src.db.session import get_db_session
from src.selection_binding.models import BindingRequest
from src.selection_binding.router import router

ROOT = Path(__file__).parent.parent
TENANT_A = "ten_aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa"
TENANT_B = "ten_bbbbbbbb-0000-7000-8000-bbbbbbbbbbbb"
WORKSPACE_A = "ws_cccccccc-0000-7000-8000-cccccccccccc"
WORKSPACE_B = "ws_dddddddd-0000-7000-8000-dddddddddddd"


@pytest.fixture(scope="module")
def postgres_url() -> Generator[str, None, None]:
    with PostgresContainer(
        "pgvector/pgvector:pg16",
        dbname="intelligence_db",
        username="intelligence_service",
        password="testpass",
    ) as postgres:
        url = postgres.get_connection_url()
        config = AlembicConfig(str(ROOT / "alembic.ini"))
        config.set_main_option("script_location", str(ROOT / "alembic"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")
        yield url


def seed(url: str, tenant: str, **data: object) -> None:
    async def run() -> None:
        engine = create_async_engine(make_url(url).set(drivername="postgresql+asyncpg"))
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            await CapabilityRegistryRepository(session).register(
                tenant, RegisterCapability.model_validate(data)
            )
        await engine.dispose()

    asyncio.run(run())


@pytest.fixture
def client(postgres_url: str) -> Generator[TestClient, None, None]:
    app = FastAPI()
    app.include_router(router)
    async_url = make_url(postgres_url).set(drivername="postgresql+asyncpg")

    async def session() -> AsyncGenerator[AsyncSession, None]:
        engine = create_async_engine(async_url)
        async with async_sessionmaker(engine, expire_on_commit=False)() as value:
            yield value
        await engine.dispose()

    app.dependency_overrides[get_db_session] = session
    with TestClient(app) as value:
        yield value


def payload(workspace: str = WORKSPACE_A) -> dict[str, object]:
    architecture = ArchitectureSpec(
        source_task_skeleton_version="1",
        topology="single",
        constraints=SynthesisConstraints(),
        nodes=[
            ArchitectureNode(
                source_node_key="node",
                role="direct",
                execution_kind="llm",
                depends_on=[],
                capability_role=EligibleCapabilityRole(
                    source_node_key="node",
                    required_capabilities=["text.generation"],
                    eligible_kinds=["model"],
                ),
            )
        ],
        execution_waves=[ExecutionWave(order=0, node_keys=["node"])],
        rationale=["test"],
        confidence=1,
    )
    return BindingRequest(
        tenant_id=TENANT_A, workspace_id=workspace, architecture=architecture
    ).model_dump(mode="json")


def test_route_filters_tenant_workspace_inactive_and_pins_version(
    client: TestClient, postgres_url: str
) -> None:
    for tenant, identifier, workspace, available in [
        (TENANT_B, "foreign", None, True),
        (TENANT_A, "inactive", WORKSPACE_A, False),
        (TENANT_A, "pinned", WORKSPACE_A, True),
    ]:
        seed(
            postgres_url,
            tenant,
            capability_id=identifier,
            kind="model",
            scope="workspace" if workspace else "tenant",
            workspace_id=workspace,
            supported_capabilities=["text.generation"],
            availability={"available": available, "reliability": 0.9},
            provenance={"source": "test"},
        )
    response = client.post("/selection-binding/bind-architecture", json=payload())
    assert response.status_code == 200
    assert response.json()["bindings"][0]["record_id"] == "pinned"
    assert response.json()["bindings"][0]["version"] == 1
    assert (
        client.post("/selection-binding/bind-architecture", json=payload(WORKSPACE_B)).json()[
            "status"
        ]
        == "blocked"
    )
