from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol, cast

from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from src.db.models import Chunk, Document, DocumentVersion, IngestionJob, Source

from .models import IngestionStage

_SET_TENANT = text("SELECT set_config('app.current_tenant_id', :tenant_id, true)")
_LOCK_CONTENT = text(
    "SELECT pg_advisory_xact_lock(hashtextextended(:idempotency_key, 0))"
)


class SourceNotFoundError(LookupError):
    pass


class IngestionJobNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class StoredIngestionJob:
    ingestion_job_id: str
    source_id: str
    stage: IngestionStage
    stats: dict[str, object]
    error: dict[str, object] | None
    created_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True)
class EmbeddedChunk:
    chunk_id: str
    seq: int
    text: str
    embedding: tuple[float, ...]
    embedding_provider: str
    embedding_model: str
    embedding_version: str


class IngestionRepository(Protocol):
    def receive(
        self,
        *,
        ingestion_job_id: str,
        tenant_uuid: str,
        source_id: str,
        content_hash: str,
        content_bytes: int,
        content_type: str,
    ) -> StoredIngestionJob: ...

    def transition(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
        expected_stage: IngestionStage,
        target_stage: IngestionStage,
        stats: dict[str, object],
    ) -> StoredIngestionJob: ...

    def fail(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
        expected_stage: IngestionStage,
        error: dict[str, object],
        stats: dict[str, object] | None = None,
    ) -> StoredIngestionJob: ...

    def complete_deduplication(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
        source_id: str,
        candidate_document_id: str,
        normalized_content_hash: str,
        content_ref: str,
        normalized_ref: str,
        provenance: dict[str, object],
        permissions: dict[str, object],
    ) -> StoredIngestionJob: ...

    def get(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
    ) -> StoredIngestionJob: ...

    def mark_indexed_as_duplicate(
        self, *, tenant_uuid: str, ingestion_job_id: str
    ) -> StoredIngestionJob: ...

    def create_chunks_and_index(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
        scope_id: str,
        document_id: str,
        document_version: int,
        chunks: Sequence[EmbeddedChunk],
    ) -> StoredIngestionJob: ...


class SqlAlchemyIngestionRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def receive(
        self,
        *,
        ingestion_job_id: str,
        tenant_uuid: str,
        source_id: str,
        content_hash: str,
        content_bytes: int,
        content_type: str,
    ) -> StoredIngestionJob:
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            session.execute(
                _LOCK_CONTENT,
                {
                    "idempotency_key": (
                        f"ads-ingestion-stage1:{tenant_uuid}:{source_id}:{content_hash}"
                    )
                },
            )
            source_exists = session.scalar(
                select(Source.id).where(
                    Source.tenant_id == tenant_uuid,
                    Source.id == source_id,
                )
            )
            if source_exists is None:
                raise SourceNotFoundError("Source does not exist for requesting tenant")

            existing = session.scalar(
                select(IngestionJob).where(
                    IngestionJob.tenant_id == tenant_uuid,
                    IngestionJob.source_id == source_id,
                    IngestionJob.stats["content_hash"].astext == content_hash,
                )
            )
            if existing is not None:
                return self._stored(existing)

            job = IngestionJob(
                id=ingestion_job_id,
                tenant_id=tenant_uuid,
                source_id=source_id,
                stage="received",
                stats={
                    "content_hash": content_hash,
                    "content_bytes": content_bytes,
                    "content_type": content_type,
                    "stage_history": ["received"],
                },
                error=None,
                completed_at=None,
            )
            session.add(job)
            session.flush()
            return self._stored(job)

    def transition(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
        expected_stage: IngestionStage,
        target_stage: IngestionStage,
        stats: dict[str, object],
    ) -> StoredIngestionJob:
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            job = self._get(session, tenant_uuid, ingestion_job_id, for_update=True)
            if job.stage != expected_stage:
                return self._stored(job)
            current_stats = dict(job.stats or {})
            history = list(cast(list[object], current_stats.get("stage_history", [])))
            history.append(target_stage)
            current_stats.update(stats)
            current_stats["stage_history"] = history
            job.stats = current_stats
            job.stage = target_stage
            session.flush()
            return self._stored(job)

    def fail(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
        expected_stage: IngestionStage,
        error: dict[str, object],
        stats: dict[str, object] | None = None,
    ) -> StoredIngestionJob:
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            job = self._get(session, tenant_uuid, ingestion_job_id, for_update=True)
            if job.stage != expected_stage:
                return self._stored(job)
            current_stats = dict(job.stats or {})
            history = list(cast(list[object], current_stats.get("stage_history", [])))
            history.append("failed")
            current_stats.update(stats or {})
            current_stats["stage_history"] = history
            job.stats = current_stats
            job.error = error
            job.stage = "failed"
            job.completed_at = datetime.now(UTC)
            session.flush()
            return self._stored(job)

    def complete_deduplication(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
        source_id: str,
        candidate_document_id: str,
        normalized_content_hash: str,
        content_ref: str,
        normalized_ref: str,
        provenance: dict[str, object],
        permissions: dict[str, object],
    ) -> StoredIngestionJob:
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            job = self._get(session, tenant_uuid, ingestion_job_id, for_update=True)
            if job.stage != "normalized":
                return self._stored(job)

            scope_id = session.scalar(
                select(Source.scope_id).where(
                    Source.tenant_id == tenant_uuid, Source.id == source_id
                )
            )
            if scope_id is None:
                raise SourceNotFoundError("Source does not exist for requesting tenant")

            existing_document_id = session.scalar(
                select(DocumentVersion.document_id)
                .join(Document, Document.id == DocumentVersion.document_id)
                .where(
                    Document.tenant_id == tenant_uuid,
                    Document.scope_id == scope_id,
                    Document.source_id == source_id,
                    DocumentVersion.content_hash == normalized_content_hash,
                )
                .limit(1)
            )

            current_stats = dict(job.stats or {})
            history = list(cast(list[object], current_stats.get("stage_history", [])))
            history.append("deduplicated")

            if existing_document_id is not None:
                current_stats["deduplication"] = {
                    "is_duplicate": True,
                    "duplicate_of_document_id": existing_document_id,
                    "scope_id": scope_id,
                }
            else:
                session.add(
                    Document(
                        id=candidate_document_id,
                        tenant_id=tenant_uuid,
                        scope_id=scope_id,
                        source_id=source_id,
                        kind="file",
                        current_version=1,
                        permissions=permissions,
                        status="active",
                    )
                )
                session.flush()
                session.add(
                    DocumentVersion(
                        document_id=candidate_document_id,
                        version=1,
                        content_ref=content_ref,
                        content_hash=normalized_content_hash,
                        normalized_ref=normalized_ref,
                        provenance=provenance,
                        ingestion_job_id=ingestion_job_id,
                    )
                )
                current_stats["deduplication"] = {
                    "is_duplicate": False,
                    "document_id": candidate_document_id,
                    "scope_id": scope_id,
                }

            current_stats["stage_history"] = history
            job.stats = current_stats
            job.stage = "deduplicated"
            session.flush()
            return self._stored(job)

    def get(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
    ) -> StoredIngestionJob:
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            job = self._get(session, tenant_uuid, ingestion_job_id, for_update=False)
            return self._stored(job)

    def mark_indexed_as_duplicate(
        self, *, tenant_uuid: str, ingestion_job_id: str
    ) -> StoredIngestionJob:
        """Duplicate content: chunks/embeddings already exist for the original
        document. No new chunk rows -- disclosed via `indexing.reused_existing_
        chunks` rather than silently re-embedding (and re-billing) identical
        content."""
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            job = self._get(session, tenant_uuid, ingestion_job_id, for_update=True)
            if job.stage != "deduplicated":
                return self._stored(job)

            current_stats = dict(job.stats or {})
            history = list(cast(list[object], current_stats.get("stage_history", [])))
            history.extend(["chunked", "indexed"])
            current_stats["stage_history"] = history
            current_stats["indexing"] = {"chunk_count": 0, "reused_existing_chunks": True}
            job.stats = current_stats
            job.stage = "indexed"
            job.completed_at = datetime.now(UTC)
            session.flush()
            return self._stored(job)

    def create_chunks_and_index(
        self,
        *,
        tenant_uuid: str,
        ingestion_job_id: str,
        scope_id: str,
        document_id: str,
        document_version: int,
        chunks: Sequence[EmbeddedChunk],
    ) -> StoredIngestionJob:
        """One atomic transition: chunked -> indexed. There is no durable
        "chunked but not embedded" state, because chunks.embedding is
        NOT NULL (KNOW-2 schema) -- embeddings are computed by the caller
        BEFORE this call (real network I/O to model-gateway's Embed RPC
        never happens inside this DB transaction), so by the time a chunk
        row can be written it is already fully indexed. Disclosed design
        decision, not an accidental stage-skip."""
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            job = self._get(session, tenant_uuid, ingestion_job_id, for_update=True)
            if job.stage != "deduplicated":
                return self._stored(job)

            for chunk in chunks:
                session.add(
                    Chunk(
                        id=chunk.chunk_id,
                        tenant_id=tenant_uuid,
                        scope_id=scope_id,
                        document_id=document_id,
                        document_version=document_version,
                        seq=chunk.seq,
                        text_content=chunk.text,
                        embedding=list(chunk.embedding),
                        embedding_provider=chunk.embedding_provider,
                        embedding_model=chunk.embedding_model,
                        embedding_version=chunk.embedding_version,
                    )
                )

            current_stats = dict(job.stats or {})
            history = list(cast(list[object], current_stats.get("stage_history", [])))
            history.extend(["chunked", "indexed"])
            current_stats["stage_history"] = history
            current_stats["indexing"] = {
                "chunk_count": len(chunks),
                "reused_existing_chunks": False,
            }
            job.stats = current_stats
            job.stage = "indexed"
            job.completed_at = datetime.now(UTC)
            session.flush()
            return self._stored(job)

    @staticmethod
    def _set_tenant(session: Session, tenant_uuid: str) -> None:
        session.execute(_SET_TENANT, {"tenant_id": tenant_uuid})

    @staticmethod
    def _get(
        session: Session,
        tenant_uuid: str,
        ingestion_job_id: str,
        *,
        for_update: bool,
    ) -> IngestionJob:
        statement = select(IngestionJob).where(
            IngestionJob.tenant_id == tenant_uuid,
            IngestionJob.id == ingestion_job_id,
        )
        if for_update:
            statement = statement.with_for_update()
        job = session.scalar(statement)
        if job is None:
            raise IngestionJobNotFoundError("Ingestion job does not exist for requesting tenant")
        return job

    @staticmethod
    def _stored(job: IngestionJob) -> StoredIngestionJob:
        return StoredIngestionJob(
            ingestion_job_id=job.id,
            source_id=job.source_id,
            stage=cast(IngestionStage, job.stage),
            stats=dict(job.stats or {}),
            error=dict(job.error) if job.error is not None else None,
            created_at=job.created_at,
            completed_at=job.completed_at,
        )
