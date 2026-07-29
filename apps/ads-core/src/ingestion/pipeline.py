from __future__ import annotations

import hashlib

from src.db.ids import new_prefixed_id, validate_prefixed_id

from .models import IngestionError, IngestionJobResponse, IngestionPayload
from .repository import IngestionRepository, StoredIngestionJob
from .scanner import ContentScanner
from .validation import PayloadValidationError, PayloadValidator


class IngestionPipeline:
    def __init__(
        self,
        *,
        repository: IngestionRepository,
        validator: PayloadValidator,
        scanner: ContentScanner,
    ) -> None:
        self._repository = repository
        self._validator = validator
        self._scanner = scanner

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
        if job.stage in {"scanned", "failed"}:
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

        return self._response(job)

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
