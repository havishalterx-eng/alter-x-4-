from __future__ import annotations

import json
import uuid
from collections.abc import Generator
from dataclasses import dataclass
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.db.ids import new_prefixed_id
from src.ingestion.repository import SqlAlchemyIngestionRepository
from src.ingestion.router import get_ingestion_repository, router

SERVICE_ROOT = Path(__file__).parent.parent
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"


@dataclass(frozen=True)
class DatabaseHarness:
    engine: sa.Engine
    sessions: sessionmaker[Session]


@pytest.fixture(scope="module")
def database() -> Generator[DatabaseHarness, None, None]:
    with PostgresContainer(
        image=PGVECTOR_IMAGE,
        dbname="ads_db",
        username="ads_core",
        password="testpass",
    ) as postgres:
        url = postgres.get_connection_url()
        alembic = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        alembic.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        alembic.set_main_option("sqlalchemy.url", url)
        command.upgrade(alembic, "head")
        engine = sa.create_engine(url)
        yield DatabaseHarness(
            engine=engine,
            sessions=sessionmaker(bind=engine, class_=Session, expire_on_commit=False),
        )
        engine.dispose()


@pytest.fixture()
def client(database: DatabaseHarness) -> Generator[TestClient, None, None]:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_ingestion_repository] = lambda: (
        SqlAlchemyIngestionRepository(database.sessions)
    )
    with TestClient(app) as test_client:
        yield test_client


def _tenant() -> tuple[str, str]:
    bare = str(uuid.uuid4())
    return f"ten_{bare}", bare


def _seed_source(
    database: DatabaseHarness,
    tenant_uuid: str,
    permissions: dict[str, object] | None,
) -> str:
    scope_id = new_prefixed_id("scp")
    source_id = new_prefixed_id("src")
    with database.engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)"),
            {"tenant": tenant_uuid},
        )
        connection.execute(
            sa.text(
                "INSERT INTO scopes(id, tenant_id, workspace_id) "
                "VALUES (:id, :tenant, :workspace)"
            ),
            {"id": scope_id, "tenant": tenant_uuid, "workspace": str(uuid.uuid4())},
        )
        connection.execute(
            sa.text(
                "INSERT INTO sources(id, tenant_id, scope_id, kind, status, permissions) "
                "VALUES (:id, :tenant, :scope, 'upload', 'active', CAST(:permissions AS jsonb))"
            ),
            {
                "id": source_id,
                "tenant": tenant_uuid,
                "scope": scope_id,
                "permissions": json.dumps(permissions),
            },
        )
    return source_id


def _stored_permissions(
    database: DatabaseHarness,
    tenant_uuid: str,
    source_id: str,
) -> dict[str, object] | None:
    with database.engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)"),
            {"tenant": tenant_uuid},
        )
        value = connection.scalar(
            sa.text(
                "SELECT permissions FROM sources "
                "WHERE tenant_id = CAST(:tenant AS uuid) AND id = :source"
            ),
            {"tenant": tenant_uuid, "source": source_id},
        )
    return None if value is None else dict(value)


def _headers(tenant_id: str) -> dict[str, str]:
    return {"X-Alter-Tenant-Id": tenant_id}


def test_source_permissions_round_trip_and_tenant_isolation(
    client: TestClient,
    database: DatabaseHarness,
) -> None:
    tenant_a, tenant_a_uuid = _tenant()
    tenant_b, _ = _tenant()
    original: dict[str, object] = {
        "visibility": "tenant",
        "shared_with": ["team_finance"],
        "retention_days": 90,
    }
    source_id = _seed_source(database, tenant_a_uuid, original)

    first = client.get(f"/ads/sources/{source_id}/permissions", headers=_headers(tenant_a))
    assert first.status_code == 200, first.text
    assert first.json() == original

    replaced = client.put(
        f"/ads/sources/{source_id}/permissions",
        json={"visibility": "tenant", "shared_with": ["team_legal"]},
        headers=_headers(tenant_a),
    )
    assert replaced.status_code == 200, replaced.text
    # PUT is a full replace: retention_days from the previous write is gone.
    expected = {"visibility": "tenant", "shared_with": ["team_legal"], "retention_days": None}
    assert replaced.json() == expected

    reread = client.get(f"/ads/sources/{source_id}/permissions", headers=_headers(tenant_a))
    assert reread.status_code == 200
    assert reread.json() == expected
    assert _stored_permissions(database, tenant_a_uuid, source_id) == expected

    for method, body in (("get", None), ("put", {"visibility": "tenant", "shared_with": ["x"]})):
        response = getattr(client, method)(
            f"/ads/sources/{source_id}/permissions",
            headers=_headers(tenant_b),
            **({"json": body} if body is not None else {}),
        )
        assert response.status_code == 404

    assert _stored_permissions(database, tenant_a_uuid, source_id) == expected


def test_unset_source_permissions_read_as_null(
    client: TestClient,
    database: DatabaseHarness,
) -> None:
    tenant_id, tenant_uuid = _tenant()
    source_id = _seed_source(database, tenant_uuid, None)

    response = client.get(f"/ads/sources/{source_id}/permissions", headers=_headers(tenant_id))
    assert response.status_code == 200
    assert response.json() is None


def test_source_permissions_reject_invalid_bodies_and_ids(
    client: TestClient,
    database: DatabaseHarness,
) -> None:
    tenant_id, tenant_uuid = _tenant()
    source_id = _seed_source(database, tenant_uuid, None)

    invalid_bodies: tuple[dict[str, object], ...] = (
        {"visibility": "public", "shared_with": []},
        {"shared_with": []},
        {"visibility": "tenant"},
        {"visibility": "tenant", "shared_with": [""]},
        {"visibility": "tenant", "shared_with": [], "retention_days": 0},
        {"visibility": "tenant", "shared_with": [], "retention_days": 4000},
        {"visibility": "tenant", "shared_with": [], "unknown": True},
    )
    for body in invalid_bodies:
        response = client.put(
            f"/ads/sources/{source_id}/permissions",
            json=body,
            headers=_headers(tenant_id),
        )
        assert response.status_code == 422, (body, response.text)

    assert _stored_permissions(database, tenant_uuid, source_id) is None

    bad_id = client.get("/ads/sources/doc_not-a-source/permissions", headers=_headers(tenant_id))
    assert bad_id.status_code == 400
