from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

IngestionStage = Literal[
    "received",
    "validated",
    "scanned",
    "normalized",
    "deduplicated",
    "chunked",
    "indexed",
    "failed",
]


class _StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class IngestionError(_StrictFrozenModel):
    code: str
    detail: str


class IngestionJobResponse(_StrictFrozenModel):
    ingestion_job_id: str
    source_id: str
    stage: IngestionStage
    stats: dict[str, object]
    error: IngestionError | None
    created_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True)
class IngestionPayload:
    tenant_id: str
    source_id: str
    content_type: str
    content: bytes


@dataclass(frozen=True)
class ScanResult:
    accepted: bool
    scanned_by: str
    limitations: tuple[str, ...]
    error_code: str | None = None
