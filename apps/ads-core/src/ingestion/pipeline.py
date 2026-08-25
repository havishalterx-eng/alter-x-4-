from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from typing import cast

from src.db.ids import new_prefixed_id, validate_prefixed_id
from src.storage.object_storage import ObjectNotFoundError, ObjectStorageProvider

from .chunking import Chunk, ChunkSplitter, UnsupportedContentTypeError
from .embedding_client import EmbeddingClient, EmbeddingDimensions
from .models import IngestionError, IngestionJobResponse, IngestionPayload, ReindexResponse
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
_EMBEDDING_MAX_CONCURRENCY = 8


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
        object_storage: ObjectStorageProvider,
        max_content_bytes: int,
        embedding_pipeline_version: str = _EMBEDDING_PIPELINE_VERSION,
    ) -> None:
        self._repository = repository
        self._validator = validator
        self._scanner = scanner
        self._normalizer = normalizer
        self._chunk_splitter = chunk_splitter
        self._embedding_client = embedding_client
        self._object_storage = object_storage
        self._max_content_bytes = max_content_bytes
        self._embedding_pipeline_version = embedding_pipeline_version

    def ingest(
        self,
        payload: IngestionPayload,
        *,
        ingestion_job_id: str | None = None,
    ) -> IngestionJobResponse:
        validate_prefixed_id("ten", payload.tenant_id)
        validate_prefixed_id("src", payload.source_id)
        tenant_uuid = payload.tenant_id.removeprefix("ten_")
        content_type = payload.content_type.partition(";")[0].strip().lower()
        content_hash = hashlib.sha256(payload.content).hexdigest()

        job = self._repository.receive(
            ingestion_job_id=ingestion_job_id or new_prefixed_id("ing"),
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
            raw_key = self._document_object_key(
                tenant_uuid=tenant_uuid,
                document_id=candidate_document_id,
                name="raw",
            )
            normalized_key = self._document_object_key(
                tenant_uuid=tenant_uuid,
                document_id=candidate_document_id,
                name="normalized",
            )
            content_ref = raw_key
            normalized_ref = normalized_key
            try:
                content_ref = self._object_storage.put_object_bytes(
                    key=raw_key,
                    content=payload.content,
                    content_type=content_type,
                )
                normalized_ref = self._object_storage.put_object_bytes(
                    key=normalized_key,
                    content=normalized.content,
                    content_type=content_type,
                )
                job = self._repository.complete_deduplication(
                    tenant_uuid=tenant_uuid,
                    ingestion_job_id=job.ingestion_job_id,
                    source_id=payload.source_id,
                    candidate_document_id=candidate_document_id,
                    normalized_content_hash=normalized.content_hash,
                    content_ref=content_ref,
                    normalized_ref=normalized_ref,
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
            except Exception:
                self._delete_objects(content_ref, normalized_ref)
                raise

            dedup = cast(dict[str, object], job.stats.get("deduplication", {}))
            if dedup.get("is_duplicate") is True:
                self._delete_objects(content_ref, normalized_ref)

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
                try:
                    chunks = self._chunk_splitter.split(
                        content=normalized.content, content_type=content_type
                    )
                except UnsupportedContentTypeError as exc:
                    # The raw/normalized objects stay in storage -- the upload
                    # itself is valid and real, only chunk-and-index has no
                    # extractor for this content type. Fail the job instead of
                    # indexing a placeholder chunk that looks searchable but
                    # never is (ENGINE-FIX-P3-25).
                    return self._response(
                        self._repository.fail(
                            tenant_uuid=tenant_uuid,
                            ingestion_job_id=job.ingestion_job_id,
                            expected_stage="deduplicated",
                            error={
                                "code": "text_extraction_unavailable",
                                "detail": str(exc),
                            },
                            stats={"chunking": {"content_type": content_type}},
                        )
                    )
                embedded_chunks = self._embed_chunks(tenant_uuid=tenant_uuid, chunks=chunks)
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
            embedding_version=self._embedding_pipeline_version,
        )

    def _embed_chunks(
        self, *, tenant_uuid: str, chunks: tuple[Chunk, ...]
    ) -> tuple[EmbeddedChunk, ...]:
        if not chunks:
            return ()
        with ThreadPoolExecutor(
            max_workers=min(_EMBEDDING_MAX_CONCURRENCY, len(chunks)),
            thread_name_prefix="ads-embed",
        ) as executor:
            futures = tuple(
                executor.submit(self._embed_chunk, tenant_uuid=tenant_uuid, chunk=chunk)
                for chunk in chunks
            )
            return tuple(future.result() for future in futures)

    def reindex(self, *, tenant_id: str, document_id: str) -> ReindexResponse:
        validate_prefixed_id("ten", tenant_id)
        validate_prefixed_id("doc", document_id)
        tenant_uuid = tenant_id.removeprefix("ten_")
        stored = self._repository.get_current_document_content(
            tenant_uuid=tenant_uuid,
            document_id=document_id,
        )
        self._assert_tenant_content_reference(
            reference=stored.content_ref,
            tenant_uuid=tenant_uuid,
            document_id=document_id,
        )
        if stored.normalized_ref is not None:
            self._assert_tenant_content_reference(
                reference=stored.normalized_ref,
                tenant_uuid=tenant_uuid,
                document_id=document_id,
            )
        try:
            content = self._object_storage.get_object_bytes(
                key=stored.normalized_ref or stored.content_ref,
                max_bytes=self._max_content_bytes,
            )
        except ObjectNotFoundError:
            if stored.normalized_ref is None:
                raise
            content = self._object_storage.get_object_bytes(
                key=stored.content_ref,
                max_bytes=self._max_content_bytes,
            )
            content = self._normalizer.normalize(
                content=content,
                content_type=stored.content_type,
            ).content
        chunks = self._chunk_splitter.split(
            content=content,
            content_type=stored.content_type,
        )
        embedded_chunks = self._embed_chunks(tenant_uuid=tenant_uuid, chunks=chunks)
        result = self._repository.activate_reindex(
            tenant_uuid=tenant_uuid,
            document_id=document_id,
            expected_document_version=stored.document_version,
            chunks=embedded_chunks,
        )
        return ReindexResponse(
            document_id=result.document_id,
            previous_document_version=result.previous_document_version,
            document_version=result.document_version,
            embedding_version=result.embedding_version,
            chunk_count=result.chunk_count,
        )

    @staticmethod
    def _document_object_key(*, tenant_uuid: str, document_id: str, name: str) -> str:
        return f"tenants/{tenant_uuid}/documents/{document_id}/versions/1/{name}"

    @staticmethod
    def _assert_tenant_content_reference(
        *, reference: str, tenant_uuid: str, document_id: str
    ) -> None:
        path = reference
        if "://" in path:
            path = path.split("://", 1)[1].partition("/")[2]
        expected = f"tenants/{tenant_uuid}/documents/{document_id}/"
        if not path.startswith(expected):
            raise ValueError("Stored content reference is outside the document tenant scope")

    def _delete_objects(self, *keys: str) -> None:
        for key in keys:
            try:
                self._object_storage.delete_object(key=key)
            except Exception:
                pass

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
