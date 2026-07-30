from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class _QueryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RetrievalRequest(_QueryModel):
    tenant_id: str
    workspace_id: str
    requester: str = Field(min_length=1, max_length=256)
    query: str = Field(min_length=1, max_length=8_000)
    top_k: int = Field(default=10, ge=1, le=50)
    scope_ids: tuple[str, ...] = ()
    metadata_filter: dict[str, object] = Field(default_factory=dict)


class RetrievalHit(_QueryModel):
    document_id: str
    chunk_id: str
    source_id: str
    scope_id: str
    context: str
    reconstructed_context: str
    score: float
    confidence: float
    provenance: dict[str, object]
    metadata: dict[str, object]
    freshness_at: datetime | None
    semantic_score: float
    keyword_score: float


class RetrievalResponse(_QueryModel):
    hits: tuple[RetrievalHit, ...]
    audited_at: datetime | None
