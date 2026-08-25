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


def _seed_document(
    database: DatabaseHarness,
    tenant_uuid: str,
    permissions: dict[str, object] | None,
) -> str:
    scope_id = new_prefixed_id("scp")
    source_id = new_prefixed_id("src")
    document_id = new_prefixed_id("doc")
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
            {
                "id": scope_id,
                "tenant": tenant_uuid,
                "workspace": str(uuid.uuid4()),
            },
        )
        connection.execute(
            sa.text(
                "INSERT INTO sources(id, tenant_id, scope_id, kind, status) "
                "VALUES (:id, :tenant, :scope, 'upload', 'active')"
            ),
            {
                "id": source_id,
                "tenant": tenant_uuid,
                "scope": scope_id,
            },
        )
        connection.execute(
            sa.text(
                "INSERT INTO documents"
                "(id, tenant_id, scope_id, source_id, kind, current_version, "
                "permissions, status) "
                "VALUES (:id, :tenant, :scope, :source, 'file', 1, "
                "CAST(:permissions AS jsonb), 'active')"
            ),
            {
                "id": document_id,
                "tenant": tenant_uuid,
                "scope": scope_id,
                "source": source_id,
                "permissions": json.dumps(permissions),
            },
        )
    return document_id


def _stored_permissions(
    database: DatabaseHarness,
    tenant_uuid: str,
    document_id: str,
) -> dict[str, object] | None:
    with database.engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)"),
            {"tenant": tenant_uuid},
        )
        value = connection.scalar(
            sa.text(
                "SELECT permissions FROM documents "
                "WHERE tenant_id = CAST(:tenant AS uuid) AND id = :document"
            ),
            {"tenant": tenant_uuid, "document": document_id},
        )
    return None if value is None else dict(value)


def _headers(tenant_id: str) -> dict[str, str]:
    return {"X-Alter-Tenant-Id": tenant_id}


def test_real_document_permissions_round_trip_and_tenant_isolation(
    client: TestClient,
    database: DatabaseHarness,
) -> None:
    tenant_a, tenant_a_uuid = _tenant()
    tenant_b, _ = _tenant()
    original: dict[str, object] = {
        "visibility": "tenant",
        "shared_with": ["team_finance"],
    }
    document_id = _seed_document(database, tenant_a_uuid, original)

    first = client.get(
        f"/ads/documents/{document_id}/permissions",
        headers=_headers(tenant_a),
    )
    assert first.status_code == 200, first.text
    assert first.json() == original

    changed = client.patch(
        f"/ads/documents/{document_id}/permissions",
        json={"shared_with": ["team_legal", "integration_shopify"]},
        headers=_headers(tenant_a),
    )
    assert changed.status_code == 200, changed.text
    expected = {
        "visibility": "tenant",
        "shared_with": ["team_legal", "integration_shopify"],
    }
    assert changed.json() == expected

    reread = client.get(
        f"/ads/documents/{document_id}/permissions",
        headers=_headers(tenant_a),
    )
    assert reread.status_code == 200
    assert reread.json() == expected
    assert _stored_permissions(database, tenant_a_uuid, document_id) == expected

    for method in ("get", "patch"):
        response = getattr(client, method)(
            f"/ads/documents/{document_id}/permissions",
            headers=_headers(tenant_b),
            **({"json": {"shared_with": ["attacker"]}} if method == "patch" else {}),
        )
        assert response.status_code == 404

    assert _stored_permissions(database, tenant_a_uuid, document_id) == expected

    invalid_bodies: tuple[dict[str, object], ...] = (
        {"visibility": "public"},
        {"shared_with": None},
        {"unknown": []},
        {},
    )
    for invalid_body in invalid_bodies:
        invalid = client.patch(
            f"/ads/documents/{document_id}/permissions",
            json=invalid_body,
            headers=_headers(tenant_a),
        )
        assert invalid.status_code == 422

    invalid_document = client.get(
        "/ads/documents/not-a-document/permissions",
        headers=_headers(tenant_a),
    )
    assert invalid_document.status_code == 400

    invalid_tenant = client.get(
        f"/ads/documents/{document_id}/permissions",
        headers=_headers("not-a-tenant"),
    )
    assert invalid_tenant.status_code == 400


def test_get_returns_real_null_instead_of_synthesizing_default(
    client: TestClient,
    database: DatabaseHarness,
) -> None:
    tenant_id, tenant_uuid = _tenant()
    document_id = _seed_document(database, tenant_uuid, None)

    response = client.get(
        f"/ads/documents/{document_id}/permissions",
        headers=_headers(tenant_id),
    )
    assert response.status_code == 200
    assert response.json() is None

    replacement = {"visibility": "tenant", "shared_with": []}
    updated = client.patch(
        f"/ads/documents/{document_id}/permissions",
        json=replacement,
        headers=_headers(tenant_id),
    )
    assert updated.status_code == 200
    assert updated.json() == replacement
    assert _stored_permissions(database, tenant_uuid, document_id) == replacement
