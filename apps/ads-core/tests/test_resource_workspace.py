"""ENGINE-FIX-B5-2: sources/{id}, documents/{id}, and ingestion/jobs/{id}
must expose their real owning workspace_id so platform-api's RBAC resolver
can check a request against the SPECIFIC workspace a resource belongs to,
instead of falling back to "has a role anywhere in the tenant". These tests
prove the new routes/fields return the workspace scopes.workspace_id was
actually created with, and 404 (not another tenant's data) across tenants.
"""

from __future__ import annotations

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


def _headers(tenant_id: str) -> dict[str, str]:
    return {"X-Alter-Tenant-Id": tenant_id}


def _seed_source(database: DatabaseHarness, tenant_uuid: str) -> tuple[str, str]:
    """Returns (source_id, workspace_id)."""
    scope_id = new_prefixed_id("scp")
    source_id = new_prefixed_id("src")
    workspace_id = str(uuid.uuid4())
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
            {"id": scope_id, "tenant": tenant_uuid, "workspace": workspace_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO sources(id, tenant_id, scope_id, kind, status) "
                "VALUES (:id, :tenant, :scope, 'upload', 'active')"
            ),
            {"id": source_id, "tenant": tenant_uuid, "scope": scope_id},
        )
    return source_id, workspace_id


def _seed_document(database: DatabaseHarness, tenant_uuid: str) -> tuple[str, str, str]:
    """Returns (document_id, source_id, workspace_id)."""
    source_id, workspace_id = _seed_source(database, tenant_uuid)
    document_id = new_prefixed_id("doc")
    with database.engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)"),
            {"tenant": tenant_uuid},
        )
        scope_id = connection.scalar(
            sa.text(
                "SELECT scope_id FROM sources "
                "WHERE tenant_id = CAST(:tenant AS uuid) AND id = :source"
            ),
            {"tenant": tenant_uuid, "source": source_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO documents"
                "(id, tenant_id, scope_id, source_id, kind, current_version, status) "
                "VALUES (:id, :tenant, :scope, :source, 'file', 1, 'active')"
            ),
            {
                "id": document_id,
                "tenant": tenant_uuid,
                "scope": scope_id,
                "source": source_id,
            },
        )
    return document_id, source_id, workspace_id


def _seed_ingestion_job(database: DatabaseHarness, tenant_uuid: str) -> tuple[str, str]:
    """Returns (ingestion_job_id, workspace_id)."""
    source_id, workspace_id = _seed_source(database, tenant_uuid)
    repository = SqlAlchemyIngestionRepository(database.sessions)
    job = repository.reserve_upload(
        ingestion_job_id=new_prefixed_id("job"),
        tenant_uuid=tenant_uuid,
        source_id=source_id,
        upload_key="uploads/test.txt",
        content_type="text/plain",
    )
    return job.ingestion_job_id, workspace_id


def test_source_workspace_reflects_real_owning_workspace_and_is_tenant_isolated(
    client: TestClient,
    database: DatabaseHarness,
) -> None:
    tenant_a, tenant_a_uuid = _tenant()
    tenant_b, _ = _tenant()
    source_id, workspace_id = _seed_source(database, tenant_a_uuid)

    own = client.get(f"/ads/sources/{source_id}", headers=_headers(tenant_a))
    assert own.status_code == 200, own.text
    assert own.json() == {"id": source_id, "workspace_id": workspace_id}

    cross_tenant = client.get(f"/ads/sources/{source_id}", headers=_headers(tenant_b))
    assert cross_tenant.status_code == 404


def test_document_workspace_reflects_real_owning_workspace_and_is_tenant_isolated(
    client: TestClient,
    database: DatabaseHarness,
) -> None:
    tenant_a, tenant_a_uuid = _tenant()
    tenant_b, _ = _tenant()
    document_id, _source_id, workspace_id = _seed_document(database, tenant_a_uuid)

    own = client.get(f"/ads/documents/{document_id}", headers=_headers(tenant_a))
    assert own.status_code == 200, own.text
    assert own.json() == {"id": document_id, "workspace_id": workspace_id}

    cross_tenant = client.get(f"/ads/documents/{document_id}", headers=_headers(tenant_b))
    assert cross_tenant.status_code == 404


def test_ingestion_job_response_carries_its_source_workspace_and_is_tenant_isolated(
    client: TestClient,
    database: DatabaseHarness,
) -> None:
    tenant_a, tenant_a_uuid = _tenant()
    tenant_b, _ = _tenant()
    ingestion_job_id, workspace_id = _seed_ingestion_job(database, tenant_a_uuid)

    own = client.get(f"/ads/ingestion/jobs/{ingestion_job_id}", headers=_headers(tenant_a))
    assert own.status_code == 200, own.text
    assert own.json()["workspace_id"] == workspace_id

    cross_tenant = client.get(
        f"/ads/ingestion/jobs/{ingestion_job_id}", headers=_headers(tenant_b)
    )
    assert cross_tenant.status_code == 404
