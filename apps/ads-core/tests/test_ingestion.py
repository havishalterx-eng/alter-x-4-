from __future__ import annotations

import hashlib
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
from src.ingestion.models import IngestionPayload, ScanResult
from src.ingestion.pipeline import IngestionPipeline
from src.ingestion.repository import (
    IngestionRepository,
    SqlAlchemyIngestionRepository,
    StoredIngestionJob,
)
from src.ingestion.router import get_ingestion_pipeline, router
from src.ingestion.scanner import ContentScanner, DisclosedStubScanner
from src.ingestion.validation import PayloadValidator

SERVICE_ROOT = Path(__file__).parent.parent
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"
RUNTIME_ROLE = "ads_ingestion_runtime"
RUNTIME_PASSWORD = "runtime-test-password"
KNOWN_BAD = b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE"
ALLOWED_TYPES = frozenset(
    {"application/json", "text/plain", "application/pdf", "image/png", "image/jpeg"}
)


@dataclass(frozen=True)
class DatabaseHarness:
    admin_engine: sa.Engine
    runtime_engine: sa.Engine
    sessions: sessionmaker[Session]


@pytest.fixture(scope="module")
def database() -> Generator[DatabaseHarness, None, None]:
    with PostgresContainer(
        image=PGVECTOR_IMAGE,
        dbname="ads_db",
        username="ads_core",
        password="testpass",
    ) as pg:
        admin_url = pg.get_connection_url()
        alembic_cfg = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        alembic_cfg.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        alembic_cfg.set_main_option("sqlalchemy.url", admin_url)
        command.upgrade(alembic_cfg, "head")

        admin_engine = sa.create_engine(admin_url)
        with admin_engine.begin() as connection:
            connection.execute(
                sa.text(f"CREATE ROLE {RUNTIME_ROLE} LOGIN PASSWORD '{RUNTIME_PASSWORD}'")
            )
            connection.execute(sa.text(f"GRANT CONNECT ON DATABASE ads_db TO {RUNTIME_ROLE}"))
            connection.execute(sa.text(f"GRANT USAGE ON SCHEMA public TO {RUNTIME_ROLE}"))
            connection.execute(sa.text(f"GRANT SELECT ON sources TO {RUNTIME_ROLE}"))
            connection.execute(
                sa.text(
                    f"GRANT SELECT, INSERT, UPDATE ON ingestion_jobs TO {RUNTIME_ROLE}"
                )
            )

        runtime_url = sa.engine.make_url(admin_url).set(
            username=RUNTIME_ROLE,
            password=RUNTIME_PASSWORD,
        )
        runtime_engine = sa.create_engine(runtime_url)
        sessions = sessionmaker(
            bind=runtime_engine,
            class_=Session,
            expire_on_commit=False,
        )
        yield DatabaseHarness(
            admin_engine=admin_engine,
            runtime_engine=runtime_engine,
            sessions=sessions,
        )
        runtime_engine.dispose()
        admin_engine.dispose()


def _new_tenant() -> tuple[str, str]:
    bare = str(uuid.uuid4())
    return f"ten_{bare}", bare


def _seed_source(database: DatabaseHarness, tenant_uuid: str) -> str:
    source_id = new_prefixed_id("src")
    scope_id = new_prefixed_id("scp")
    with database.admin_engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant_uuid},
        )
        connection.execute(
            sa.text(
                "INSERT INTO scopes (id, tenant_id, workspace_id) VALUES (:id, :tenant, :workspace)"
            ),
            {
                "id": scope_id,
                "tenant": tenant_uuid,
                "workspace": str(uuid.uuid4()),
            },
        )
        connection.execute(
            sa.text(
                "INSERT INTO sources (id, tenant_id, scope_id, kind, status) "
                "VALUES (:id, :tenant, :scope, 'upload', 'active')"
            ),
            {"id": source_id, "tenant": tenant_uuid, "scope": scope_id},
        )
    return source_id


def _pipeline(
    database: DatabaseHarness,
    *,
    max_content_bytes: int = 1024,
    repository: IngestionRepository | None = None,
    scanner: ContentScanner | None = None,
) -> IngestionPipeline:
    return IngestionPipeline(
        repository=repository or SqlAlchemyIngestionRepository(database.sessions),
        validator=PayloadValidator(
            max_content_bytes=max_content_bytes,
            allowed_content_types=ALLOWED_TYPES,
        ),
        scanner=scanner or DisclosedStubScanner((KNOWN_BAD,)),
    )


class RecordingRepository:
    """Delegates to real Postgres and snapshots every committed transition."""

    def __init__(
        self,
        delegate: SqlAlchemyIngestionRepository,
        sessions: sessionmaker[Session],
    ) -> None:
        self._delegate = delegate
        self._sessions = sessions
        self.committed_stages: list[str] = []

    def receive(self, **kwargs: object) -> StoredIngestionJob:
        job = self._delegate.receive(**kwargs)  # type: ignore[arg-type]
        self._record(str(kwargs["tenant_uuid"]), job.ingestion_job_id)
        return job

    def transition(self, **kwargs: object) -> StoredIngestionJob:
        job = self._delegate.transition(**kwargs)  # type: ignore[arg-type]
        self._record(str(kwargs["tenant_uuid"]), job.ingestion_job_id)
        return job

    def fail(self, **kwargs: object) -> StoredIngestionJob:
        job = self._delegate.fail(**kwargs)  # type: ignore[arg-type]
        self._record(str(kwargs["tenant_uuid"]), job.ingestion_job_id)
        return job

    def _record(self, tenant_uuid: str, ingestion_job_id: str) -> None:
        with self._sessions.begin() as session:
            session.execute(
                sa.text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
                {"tenant_id": tenant_uuid},
            )
            stage = session.scalar(
                sa.text("SELECT stage FROM ingestion_jobs WHERE id = :id"),
                {"id": ingestion_job_id},
            )
            assert stage is not None
            self.committed_stages.append(str(stage))


def test_upload_walks_all_three_durable_stages(database: DatabaseHarness) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)
    recording = RecordingRepository(
        SqlAlchemyIngestionRepository(database.sessions),
        database.sessions,
    )
    pipeline = _pipeline(database, repository=recording)
    application = FastAPI()
    application.include_router(router)
    application.dependency_overrides[get_ingestion_pipeline] = lambda: pipeline
    content = b'{"project":"Alter"}'

    response = TestClient(application).post(
        "/ads/ingestion/uploads",
        content=content,
        headers={
            "Content-Type": "application/json",
            "X-Alter-Tenant-Id": tenant_id,
            "X-Alter-Source-Id": source_id,
        },
    )

    assert response.status_code == 202
    body = response.json()
    assert body["stage"] == "scanned"
    assert body["stats"]["content_hash"] == hashlib.sha256(content).hexdigest()
    assert body["stats"]["stage_history"] == ["received", "validated", "scanned"]
    assert recording.committed_stages == ["received", "validated", "scanned"]


@pytest.mark.parametrize(
    ("content", "content_type", "error_code"),
    [
        (b"123456789", "text/plain", "content_too_large"),
        (b"<xml />", "application/xml", "content_type_not_allowed"),
    ],
)
def test_validation_rejects_oversize_and_disallowed_mime(
    database: DatabaseHarness,
    content: bytes,
    content_type: str,
    error_code: str,
) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)

    result = _pipeline(database, max_content_bytes=8).ingest(
        IngestionPayload(tenant_id, source_id, content_type, content)
    )

    assert result.stage == "failed"
    assert result.error is not None
    assert result.error.code == error_code
    assert result.stats["stage_history"] == ["received", "failed"]


def test_scan_rejects_known_bad_signature(database: DatabaseHarness) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)

    result = _pipeline(database).ingest(
        IngestionPayload(tenant_id, source_id, "text/plain", b"prefix " + KNOWN_BAD)
    )

    assert result.stage == "failed"
    assert result.error is not None
    assert result.error.code == "known_bad_signature"
    assert result.stats["stage_history"] == ["received", "validated", "failed"]
    assert result.stats["scanned_by"] == "stub"
    assert KNOWN_BAD.decode() not in json.dumps(result.model_dump(mode="json"))


def test_malformed_declared_content_fails_validation(database: DatabaseHarness) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)

    result = _pipeline(database).ingest(
        IngestionPayload(tenant_id, source_id, "application/json", b"not-json")
    )

    assert result.stage == "failed"
    assert result.error is not None
    assert result.error.code == "malformed_content"
    assert result.stats["stage_history"] == ["received", "failed"]


class _FailingScanner:
    def scan(self, *, content: bytes, content_type: str) -> ScanResult:
        del content, content_type
        raise RuntimeError("sensitive scanner diagnostic")


def test_scanner_failure_fails_closed_without_leaking_diagnostic(
    database: DatabaseHarness,
) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)

    result = _pipeline(database, scanner=_FailingScanner()).ingest(
        IngestionPayload(tenant_id, source_id, "text/plain", b"ordinary content")
    )

    assert result.stage == "failed"
    assert result.error is not None
    assert result.error.code == "scanner_unavailable"
    assert result.stats["stage_history"] == ["received", "validated", "failed"]
    assert "sensitive scanner diagnostic" not in json.dumps(result.model_dump(mode="json"))


def test_stub_clean_result_discloses_its_limits(database: DatabaseHarness) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)

    result = _pipeline(database).ingest(
        IngestionPayload(tenant_id, source_id, "text/plain", b"ordinary clean fixture")
    )

    assert result.stage == "scanned"
    assert result.stats["scanned_by"] == "stub"
    assert result.stats["scan_limitations"] == [
        "signature_only",
        "no_antivirus_engine",
        "no_archive_expansion",
    ]


def test_same_tenant_source_and_hash_is_idempotent(database: DatabaseHarness) -> None:
    tenant_id, tenant_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_uuid)
    pipeline = _pipeline(database)
    payload = IngestionPayload(tenant_id, source_id, "application/json", b'{"same":true}')

    first = pipeline.ingest(payload)
    second = pipeline.ingest(payload)

    assert first.ingestion_job_id == second.ingestion_job_id
    with database.runtime_engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant_uuid},
        )
        count = connection.scalar(
            sa.text(
                "SELECT count(*) FROM ingestion_jobs "
                "WHERE source_id = :source AND stats->>'content_hash' = :hash"
            ),
            {
                "source": source_id,
                "hash": hashlib.sha256(payload.content).hexdigest(),
            },
        )
    assert count == 1


def test_runtime_role_cannot_read_another_tenants_job(database: DatabaseHarness) -> None:
    tenant_a, tenant_a_uuid = _new_tenant()
    _, tenant_b_uuid = _new_tenant()
    source_id = _seed_source(database, tenant_a_uuid)
    result = _pipeline(database).ingest(
        IngestionPayload(tenant_a, source_id, "text/plain", b"tenant private")
    )

    with database.runtime_engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant_b_uuid},
        )
        hidden_count = connection.scalar(
            sa.text("SELECT count(*) FROM ingestion_jobs WHERE id = :id"),
            {"id": result.ingestion_job_id},
        )
    with database.runtime_engine.begin() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant_id, true)"),
            {"tenant_id": tenant_a_uuid},
        )
        visible_count = connection.scalar(
            sa.text("SELECT count(*) FROM ingestion_jobs WHERE id = :id"),
            {"id": result.ingestion_job_id},
        )

    assert hidden_count == 0
    assert visible_count == 1
