"""Real-Postgres coverage for capability registry persistence and HTTP routes."""

from collections.abc import AsyncGenerator, Generator
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.capability_registry.models import RegisterCapability
from src.capability_registry.repository import CapabilityRegistryRepository
from src.capability_registry.router import router
from src.db.session import get_db_session

SERVICE_ROOT = Path(__file__).parent.parent
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"
TENANT_A = "ten_aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa"
TENANT_B = "ten_bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb"
PLATFORM = "ten_00000000-0000-7000-8000-000000000001"
WORKSPACE = "ws_cccccccc-0000-4000-8000-cccccccccccc"


def body(capability_id: str, **overrides: object) -> dict[str, object]:
    return {
        "capability_id": capability_id,
        "kind": "tool",
        "scope": "tenant",
        "supported_capabilities": ["text.generate"],
        "provenance": {"source": "test"},
    } | overrides


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
    with TestClient(app, headers={"authorization": "Bearer integration-token"}) as test_client:
        yield test_client


def test_routes_enforce_tenant_workspace_version_lifecycle_and_bounded_search(
    client: TestClient,
) -> None:
    created = client.post(f"/internal/capability-registry/{TENANT_A}/records", json=body("alpha"))
    assert created.status_code == 200
    duplicate = client.post(f"/internal/capability-registry/{TENANT_A}/records", json=body("alpha"))
    assert duplicate.status_code == 422
    assert "use supersede" in duplicate.json()["detail"]
    assert client.post(
        f"/internal/capability-registry/{TENANT_A}/records",
        json=body("workspace", scope="workspace", workspace_id=WORKSPACE),
    ).status_code == 200
    assert client.post(
        f"/internal/capability-registry/{PLATFORM}/records",
        json=body("global", scope="global"),
    ).status_code == 200

    hidden = client.post(f"/internal/capability-registry/{TENANT_B}/search", json={}).json()
    assert [row["capability_id"] for row in hidden] == ["global"]
    unfiltered = client.post(f"/internal/capability-registry/{TENANT_A}/search", json={}).json()
    assert [row["capability_id"] for row in unfiltered] == ["alpha", "global", "workspace"]
    workspace = client.post(
        f"/internal/capability-registry/{TENANT_A}/search", json={"workspace_id": WORKSPACE}
    ).json()
    assert [row["capability_id"] for row in workspace] == ["alpha", "global", "workspace"]
    assert client.post(
        f"/internal/capability-registry/{TENANT_A}/search", json={"limit": 2}
    ).json() == unfiltered[:2]

    replacement = client.post(
        f"/internal/capability-registry/{TENANT_A}/records/alpha/supersede", json=body("alpha")
    )
    assert replacement.status_code == 200
    assert replacement.json()["version"] == 2
    history = client.post(
        f"/internal/capability-registry/{TENANT_A}/search", json={"include_inactive": True}
    ).json()
    alpha_history = [
        (row["version"], row["status"])
        for row in history
        if row["capability_id"] == "alpha"
    ]
    assert alpha_history == [
        (2, "active"),
        (1, "superseded"),
    ]
    assert client.post(
        f"/internal/capability-registry/{TENANT_A}/records/alpha/2/deactivate"
    ).status_code == 204


@pytest.mark.asyncio
async def test_supersede_rolls_back_when_replacement_insert_fails(postgres_url: str) -> None:
    engine = create_async_engine(make_url(postgres_url).set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(engine, expire_on_commit=False)
    request = RegisterCapability.model_validate(body("atomic"))
    async with factory() as session:
        repository = CapabilityRegistryRepository(session)
        await repository.register(TENANT_A, request)

        invalid_replacement = RegisterCapability.model_construct(
            **(request.model_dump() | {"scope": "workspace", "workspace_id": None})
        )
        with pytest.raises(Exception):
            await repository.supersede(TENANT_A, "atomic", invalid_replacement)
    async with factory() as session:
        record = await CapabilityRegistryRepository(session).get(TENANT_A, "atomic", 1)
        assert record.status == "active"
    await engine.dispose()


def test_rls_hides_private_registry_records(postgres_url: str) -> None:
    tenant_a = TENANT_A.removeprefix("ten_")
    tenant_b = TENANT_B.removeprefix("ten_")
    setup = sa.create_engine(postgres_url, isolation_level="AUTOCOMMIT")
    with setup.connect() as connection:
        connection.execute(sa.text("DROP ROLE IF EXISTS capability_registry_reader"))
        connection.execute(sa.text("CREATE ROLE capability_registry_reader"))
        connection.execute(
            sa.text("GRANT SELECT ON capability_registry_versions TO capability_registry_reader")
        )
    engine = sa.create_engine(postgres_url)
    with engine.connect() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, false)"),
            {"tenant": tenant_a},
        )
        connection.execute(
            sa.text(
                "INSERT INTO capability_registry_versions "
                "(capability_id, version, owner_tenant_id, scope, kind, supported_capabilities, "
                "constraints, availability, provenance, metadata, status) "
                "VALUES ('rls-private', 1, CAST(:tenant AS uuid), 'tenant', 'tool', "
                "'[]'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'active')"
            ),
            {"tenant": tenant_a},
        )
        connection.commit()
        connection.execute(sa.text("SET ROLE capability_registry_reader"))
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, false)"),
            {"tenant": tenant_b},
        )
        count_sql = sa.text(
            "SELECT count(*) FROM capability_registry_versions WHERE capability_id = 'rls-private'"
        )
        assert connection.execute(count_sql).scalar() == 0
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, false)"),
            {"tenant": tenant_a},
        )
        assert connection.execute(count_sql).scalar() == 1
        connection.execute(sa.text("RESET ROLE"))
        connection.rollback()
