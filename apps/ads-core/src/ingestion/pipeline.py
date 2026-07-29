from __future__ import annotations

import hashlib
from typing import cast

from src.db.ids import new_prefixed_id, validate_prefixed_id

from .chunking import Chunk, ChunkSplitter
from .embedding_client import EmbeddingClient, EmbeddingDimensions
from .models import IngestionError, IngestionJobResponse, IngestionPayload
from .normalization import ContentNormalizer
from .permissions import default_permissions
from .repository import EmbeddedChunk, IngestionRepository, StoredIngestionJob
from .scanner import ContentScanner
from .validation import PayloadValidationError, PayloadValidator

# ADS retrieval embedding space is 1024-dim (doc 04 section 1) -- separate
# from model-gateway's own 512-dim semantic-cache space; never compared
# across embedding spaces.
_EMBEDDING_DIMENSIONS: EmbeddingDimensions = 1024
_EMBEDDING_PROVIDER = "aws-bedrock"
# Labels THIS pipeline's own embedding integration, not the vendor model
# version (which is already captured verbatim in embedding_model from the
# Embed RPC response) -- same "our own algorithm version" convention as
# normalization.py's normalized_by strings.
_EMBEDDING_PIPELINE_VERSION = "v1"


class IngestionPipeline:
    def __init__(
        self,
        *,
        repository: IngestionRepository,
        validator: PayloadValidator,
        scanner: ContentScanner,
        normalizer: ContentNormalizer,
        chunk_splitter: ChunkSplitter,
        embedding_client: EmbeddingClient,
    ) -> None:
        self._repository = repository
        self._validator = validator
        self._scanner = scanner
        self._normalizer = normalizer
        self._chunk_splitter = chunk_splitter
        self._embedding_client = embedding_client

    def ingest(self, payload: IngestionPayload) -> IngestionJobResponse:
        validate_prefixed_id("ten", payload.tenant_id)
        validate_prefixed_id("src", payload.source_id)
        tenant_uuid = payload.tenant_id.removeprefix("ten_")
        content_type = payload.content_type.partition(";")[0].strip().lower()
        content_hash = hashlib.sha256(payload.content).hexdigest()

        job = self._repository.receive(
            ingestion_job_id=new_prefixed_id("ing"),
            tenant_uuid=tenant_uuid,
            source_id=payload.source_id,
            content_hash=content_hash,
            content_bytes=len(payload.content),
            content_type=content_type,
        )
        if job.stage in {"indexed", "failed"}:
            return self._response(job)

        if job.stage == "received":
            try:
                self._validator.validate(content=payload.content, content_type=content_type)
            except PayloadValidationError as exc:
                return self._response(
                    self._repository.fail(
                        tenant_uuid=tenant_uuid,
                        ingestion_job_id=job.ingestion_job_id,
                        expected_stage="received",
                        error={"code": exc.code, "detail": exc.detail},
                    )
                )
            job = self._repository.transition(
                tenant_uuid=tenant_uuid,
                ingestion_job_id=job.ingestion_job_id,
                expected_stage="received",
                target_stage="validated",
                stats={"validation": {"status": "passed"}},
            )

        if job.stage == "validated":
            try:
                scan = self._scanner.scan(content=payload.content, content_type=content_type)
            except Exception:
                return self._response(
                    self._repository.fail(
                        tenant_uuid=tenant_uuid,
                        ingestion_job_id=job.ingestion_job_id,
                        expected_stage="validated",
                        error={
                            "code": "scanner_unavailable",
                            "detail": "Content scanner failed; ingestion stopped closed",
                        },
                    )
                )
            scan_stats: dict[str, object] = {
                "scanned_by": scan.scanned_by,
                "scan_limitations": list(scan.limitations),
            }
            if not scan.accepted:
                return self._response(
                    self._repository.fail(
                        tenant_uuid=tenant_uuid,
                        ingestion_job_id=job.ingestion_job_id,
                        expected_stage="validated",
                        error={
                            "code": scan.error_code or "content_rejected",
                            "detail": "Content scanner rejected payload",
                        },
                        stats=scan_stats,
                    )
                )
            job = self._repository.transition(
                tenant_uuid=tenant_uuid,
                ingestion_job_id=job.ingestion_job_id,
                expected_stage="validated",
                target_stage="scanned",
                stats=scan_stats,
            )

        # Computed unconditionally (not only inside the "scanned" branch below) so
        # a resumed job that already reached "normalized" in a prior call still has
        # `normalized` available -- normalize() is a pure function of the payload,
        # safe and cheap to recompute on every call.
        normalized = self._normalizer.normalize(content=payload.content, content_type=content_type)

        if job.stage == "scanned":
            job = self._repository.transition(
                tenant_uuid=tenant_uuid,
                ingestion_job_id=job.ingestion_job_id,
                expected_stage="scanned",
                target_stage="normalized",
                stats={
                    "normalization": {
                        "normalized_by": normalized.normalized_by,
                        "limitations": list(normalized.limitations),
                        "normalized_content_hash": normalized.content_hash,
                    }
                },
            )

        if job.stage == "normalized":
            candidate_document_id = new_prefixed_id("doc")
            job = self._repository.complete_deduplication(
                tenant_uuid=tenant_uuid,
                ingestion_job_id=job.ingestion_job_id,
                source_id=payload.source_id,
                candidate_document_id=candidate_document_id,
                normalized_content_hash=normalized.content_hash,
                content_ref=f"ads-synthetic://{tenant_uuid}/{candidate_document_id}/raw",
                normalized_ref=f"ads-synthetic://{tenant_uuid}/{candidate_document_id}/normalized",
                provenance={
                    "ingestion_job_id": job.ingestion_job_id,
                    "source_id": payload.source_id,
                    "content_type": content_type,
                    "raw_content_hash": content_hash,
                    "normalized_by": normalized.normalized_by,
                    "normalization_limitations": list(normalized.limitations),
                },
                permissions=default_permissions(),
            )

        if job.stage == "deduplicated":
            dedup = cast(dict[str, object], job.stats.get("deduplication", {}))
            if dedup.get("is_duplicate") is True:
                job = self._repository.mark_indexed_as_duplicate(
                    tenant_uuid=tenant_uuid,
                    ingestion_job_id=job.ingestion_job_id,
                )
            else:
                document_id = str(dedup["document_id"])
                scope_id = str(dedup["scope_id"])
                chunks = self._chunk_splitter.split(
                    content=normalized.content, content_type=content_type
                )
                embedded_chunks = tuple(
                    self._embed_chunk(tenant_uuid=tenant_uuid, chunk=chunk) for chunk in chunks
                )
                job = self._repository.create_chunks_and_index(
                    tenant_uuid=tenant_uuid,
                    ingestion_job_id=job.ingestion_job_id,
                    scope_id=scope_id,
                    document_id=document_id,
                    document_version=1,
                    chunks=embedded_chunks,
                )

        return self._response(job)

    def _embed_chunk(self, *, tenant_uuid: str, chunk: Chunk) -> EmbeddedChunk:
        result = self._embedding_client.embed(
            tenant_id=f"ten_{tenant_uuid}",
            text=chunk.text,
            dimensions=_EMBEDDING_DIMENSIONS,
        )
        return EmbeddedChunk(
            chunk_id=new_prefixed_id("chk"),
            seq=chunk.seq,
            text=chunk.text,
            embedding=result.vector,
            embedding_provider=_EMBEDDING_PROVIDER,
            embedding_model=result.model_id,
            embedding_version=_EMBEDDING_PIPELINE_VERSION,
        )

    @staticmethod
    def _response(job: StoredIngestionJob) -> IngestionJobResponse:
        error = IngestionError.model_validate(job.error) if job.error is not None else None
        return IngestionJobResponse(
            ingestion_job_id=job.ingestion_job_id,
            source_id=job.source_id,
            stage=job.stage,
            stats=job.stats,
            error=error,
            created_at=job.created_at,
            completed_at=job.completed_at,
        )
