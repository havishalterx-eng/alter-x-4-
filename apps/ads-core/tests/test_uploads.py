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
from src.config import Settings
from src.db.ids import new_prefixed_id
from src.ingestion import router as router_module
from src.ingestion.chunking import ParagraphAwareChunkSplitter
from src.ingestion.embedding_client import EmbeddingDimensions, EmbeddingResult
from src.ingestion.router import router
from src.storage.object_storage import InMemoryObjectStorageProvider, S3ObjectStorageProvider

SERVICE_ROOT = Path(__file__).parent.parent
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"


class _FakeEmbeddingClient:
    """Deterministic in-process fake -- this test never dials real gRPC."""

    def embed(
        self, *, tenant_id: str, text: str, dimensions: EmbeddingDimensions
    ) -> EmbeddingResult:
        del tenant_id, text
        return EmbeddingResult(vector=tuple(0.5 for _ in range(dimensions)), model_id="fake-model")


@dataclass(frozen=True)
class DatabaseHarness:
    engine: sa.Engine
    sessions: sessionmaker[Session]
    url: str


@pytest.fixture(scope="module")
def database() -> Generator[DatabaseHarness, None, None]:
    with PostgresContainer(
        image=PGVECTOR_IMAGE,
        dbname="ads_db",
        username="ads_core",
        password="testpass",
    ) as pg:
        url = pg.get_connection_url()
        alembic_cfg = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        alembic_cfg.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        alembic_cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(alembic_cfg, "head")

        engine = sa.create_engine(url)
        sessions = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
        yield DatabaseHarness(engine=engine, sessions=sessions, url=url)
        engine.dispose()


def _new_tenant() -> tuple[str, str]:
    bare = str(uuid.uuid4())
    return f"ten_{bare}", bare


def _seed_source(database: DatabaseHarness, tenant_uuid: str) -> str:
    source_id = new_prefixed_id("src")
    scope_id = new_prefixed_id("scp")
    with database.engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant_uuid},
        )
        connection.execute(
            sa.text(
                "INSERT INTO scopes (id, tenant_id, workspace_id) VALUES (:id, :tenant, :workspace)"
            ),
            {"id": scope_id, "tenant": tenant_uuid, "workspace": str(uuid.uuid4())},
        )
        connection.execute(
            sa.text(
                "INSERT INTO sources (id, tenant_id, scope_id, kind, status) "
                "VALUES (:id, :tenant, :scope, 'upload', 'active')"
            ),
            {"id": source_id, "tenant": tenant_uuid, "scope": scope_id},
        )
    return source_id


@pytest.fixture()
def client(database: DatabaseHarness) -> Generator[TestClient, None, None]:
    settings = Settings(
        ads_db_url_sync=database.url,
        ads_ingestion_max_content_bytes=1024,
        ads_uploads_bucket_name="",  # forces InMemoryObjectStorageProvider
        deletion_service_token_sha256="a" * 64,
    )
    app = FastAPI()
    app.include_router(router)

    # `ingestion_lifespan` is deliberately not attached here -- it builds
    # its own engine from `get_settings()` (a module-level singleton), which
    # would fight this test's per-test `Settings` instance. Assigning the
    # router module's globals directly is the simpler, equally-real path:
    # every request still goes through the real router functions and the
    # real Postgres/`InMemoryObjectStorageProvider` instances below.
    from sqlalchemy import create_engine

    engine = create_engine(settings.ads_db_url_sync, pool_pre_ping=True)
    sessions = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    from src.ingestion.normalization import TextAwareNormalizer
    from src.ingestion.pipeline import IngestionPipeline
    from src.ingestion.repository import SqlAlchemyIngestionRepository
    from src.ingestion.scanner import DisclosedStubScanner
    from src.ingestion.validation import PayloadValidator

    repository = SqlAlchemyIngestionRepository(sessions)
    storage = InMemoryObjectStorageProvider()
    router_module._default_repository = repository
    router_module._default_pipeline = IngestionPipeline(
        repository=repository,
        validator=PayloadValidator(
            max_content_bytes=settings.ads_ingestion_max_content_bytes,
            allowed_content_types=frozenset({"application/json", "text/plain", "application/pdf"}),
        ),
        scanner=DisclosedStubScanner((b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE",)),
        normalizer=TextAwareNormalizer(),
        chunk_splitter=ParagraphAwareChunkSplitter(),
        embedding_client=_FakeEmbeddingClient(),
        object_storage=storage,
        max_content_bytes=settings.ads_ingestion_max_content_bytes,
    )
    router_module._default_storage = storage
    router_module._default_settings = settings

    with TestClient(app) as test_client:
        test_client.storage = storage
        yield test_client

    router_module._default_pipeline = None
    router_module._default_storage = None
    router_module._default_settings = None
    router_module._default_repository = None
    engine.dispose()


def test_presign_returns_tenant_scoped_key(client: TestClient) -> None:
    tenant_id, _ = _new_tenant()
    response = client.post(
        "/ads/ingestion/uploads/presign",
        json={
            "source_id": "src_00000000-0000-7000-8000-000000000000",
            "content_type": "text/plain",
        },
        headers={"X-Alter-Tenant-Id": tenant_id},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    bare_tenant = tenant_id.removeprefix("ten_")
    assert body["upload_key"].startswith(f"tenants/{bare_tenant}/uploads/")
    assert body["max_content_bytes"] == 1024


def test_presign_rejects_disallowed_content_type(client: TestClient) -> None:
    tenant_id, _ = _new_tenant()
    response = client.post(
        "/ads/ingestion/uploads/presign",
        json={"source_id": "src_00000000-0000-7000-8000-000000000000", "content_type": "image/gif"},
        headers={"X-Alter-Tenant-Id": tenant_id},
    )
    assert response.status_code == 422


def test_complete_upload_runs_the_real_pipeline_end_to_end(
    client: TestClient, database: DatabaseHarness
) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)

    presign = client.post(
        "/ads/ingestion/uploads/presign",
        json={"source_id": source_id, "content_type": "text/plain"},
        headers={"X-Alter-Tenant-Id": tenant_id},
    ).json()

    client.storage.simulate_upload(
        key=presign["upload_key"], content=b"hello world", content_type="text/plain"
    )

    response = client.post(
        "/ads/ingestion/uploads/complete",
        json={"source_id": source_id, "upload_key": presign["upload_key"]},
        headers={"X-Alter-Tenant-Id": tenant_id},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["stage"] == "indexed"

    # Raw staging object is cleaned up post-ingestion -- not left dangling.
    assert client.storage.head_object(key=presign["upload_key"]) is None


def test_complete_upload_404s_when_object_was_never_uploaded(client: TestClient) -> None:
    tenant_id, _ = _new_tenant()
    bare = tenant_id.removeprefix("ten_")
    response = client.post(
        "/ads/ingestion/uploads/complete",
        json={
            "source_id": "src_00000000-0000-7000-8000-000000000000",
            "upload_key": f"tenants/{bare}/uploads/never-uploaded",
        },
        headers={"X-Alter-Tenant-Id": tenant_id},
    )
    assert response.status_code == 404


def test_complete_upload_rejects_a_key_scoped_to_another_tenant(client: TestClient) -> None:
    tenant_id, _ = _new_tenant()
    other_tenant, other_bare = _new_tenant()
    response = client.post(
        "/ads/ingestion/uploads/complete",
        json={
            "source_id": "src_00000000-0000-7000-8000-000000000000",
            "upload_key": f"tenants/{other_bare}/uploads/some-key",
        },
        headers={"X-Alter-Tenant-Id": tenant_id},
    )
    assert response.status_code == 403


def test_complete_upload_rejects_oversized_object(client: TestClient) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    presign = client.post(
        "/ads/ingestion/uploads/presign",
        json={
            "source_id": "src_00000000-0000-7000-8000-000000000000",
            "content_type": "text/plain",
        },
        headers={"X-Alter-Tenant-Id": tenant_id},
    ).json()
    client.storage.simulate_upload(
        key=presign["upload_key"], content=b"x" * 2048, content_type="text/plain"
    )
    response = client.post(
        "/ads/ingestion/uploads/complete",
        json={
            "source_id": "src_00000000-0000-7000-8000-000000000000",
            "upload_key": presign["upload_key"],
        },
        headers={"X-Alter-Tenant-Id": tenant_id},
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    ("content", "content_type", "error_code"),
    (
        (b"MZ executable", "application/x-msdownload", "content_type_not_allowed"),
        (b"not-json", "application/json", "malformed_content"),
        (
            b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE",
            "text/plain",
            "known_bad_signature",
        ),
        (b"\xff\xfe", "text/plain", "malformed_content"),
    ),
)
def test_redteam_malicious_uploads_fail_in_the_real_ingestion_router(
    client: TestClient,
    database: DatabaseHarness,
    content: bytes,
    content_type: str,
    error_code: str,
) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)

    response = client.post(
        "/ads/ingestion/uploads",
        content=content,
        headers={
            "Content-Type": content_type,
            "X-Alter-Tenant-Id": tenant_id,
            "X-Alter-Source-Id": source_id,
        },
    )

    assert response.status_code == 202, response.text
    body = response.json()
    assert body["stage"] == "failed"
    assert body["error"]["code"] == error_code


def test_get_ingestion_job_returns_real_status(
    client: TestClient, database: DatabaseHarness
) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)
    presign = client.post(
        "/ads/ingestion/uploads/presign",
        json={"source_id": source_id, "content_type": "text/plain"},
        headers={"X-Alter-Tenant-Id": tenant_id},
    ).json()
    client.storage.simulate_upload(
        key=presign["upload_key"], content=b"job status content", content_type="text/plain"
    )
    completed = client.post(
        "/ads/ingestion/uploads/complete",
        json={"source_id": source_id, "upload_key": presign["upload_key"]},
        headers={"X-Alter-Tenant-Id": tenant_id},
    ).json()

    response = client.get(
        f"/ads/ingestion/jobs/{completed['ingestion_job_id']}",
        headers={"X-Alter-Tenant-Id": tenant_id},
    )
    assert response.status_code == 200
    assert response.json()["stage"] == "indexed"


def test_get_ingestion_job_404s_for_unknown_job(client: TestClient) -> None:
    tenant_id, _ = _new_tenant()
    response = client.get(
        f"/ads/ingestion/jobs/{new_prefixed_id('ing')}",
        headers={"X-Alter-Tenant-Id": tenant_id},
    )
    assert response.status_code == 404


def test_get_ingestion_job_404s_across_tenants(
    client: TestClient, database: DatabaseHarness
) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    other_tenant, _ = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)
    presign = client.post(
        "/ads/ingestion/uploads/presign",
        json={"source_id": source_id, "content_type": "text/plain"},
        headers={"X-Alter-Tenant-Id": tenant_id},
    ).json()
    client.storage.simulate_upload(
        key=presign["upload_key"], content=b"cross tenant check", content_type="text/plain"
    )
    completed = client.post(
        "/ads/ingestion/uploads/complete",
        json={"source_id": source_id, "upload_key": presign["upload_key"]},
        headers={"X-Alter-Tenant-Id": tenant_id},
    ).json()

    response = client.get(
        f"/ads/ingestion/jobs/{completed['ingestion_job_id']}",
        headers={"X-Alter-Tenant-Id": other_tenant},
    )
    assert response.status_code == 404


class _StoredBody:
    def __init__(self, content: bytes) -> None:
        self._content = content

    def read(self) -> bytes:
        return self._content


class _RecordingS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def put_object(self, **kwargs: object) -> None:
        body = kwargs["Body"]
        assert isinstance(body, bytes)
        self.objects[str(kwargs["Key"])] = body

    def head_object(self, **kwargs: object) -> dict[str, object]:
        content = self.objects[str(kwargs["Key"])]
        return {"ContentLength": len(content), "ContentType": "text/plain"}

    def get_object(self, **kwargs: object) -> dict[str, object]:
        return {"Body": _StoredBody(self.objects[str(kwargs["Key"])])}

    def delete_object(self, **kwargs: object) -> None:
        key = str(kwargs["Key"])
        self.deleted.append(key)
        self.objects.pop(key, None)


def test_s3_durable_write_returns_deletion_visible_reference() -> None:
    client = _RecordingS3Client()
    storage = S3ObjectStorageProvider.__new__(S3ObjectStorageProvider)
    storage.bucket = "alter-ads"
    storage.endpoint_url = None
    storage.region = "ap-south-1"
    storage._client = client

    reference = storage.put_object_bytes(
        key="tenants/tenant/documents/doc/versions/1/raw",
        content=b"stored bytes",
        content_type="text/plain",
    )

    assert reference == "s3://alter-ads/tenants/tenant/documents/doc/versions/1/raw"
    assert storage.get_object_bytes(key=reference, max_bytes=1024) == b"stored bytes"
    storage.delete_object(key=reference)
    assert client.deleted == ["tenants/tenant/documents/doc/versions/1/raw"]
