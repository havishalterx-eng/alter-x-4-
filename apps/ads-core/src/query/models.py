from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.memory_namespace.models import MemoryFact


class _QueryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RetrievalRequest(_QueryModel):
    tenant_id: str
    workspace_id: str
    requester: str = Field(min_length=1, max_length=256)
    query: str = Field(min_length=1, max_length=8_000)
    top_k: int = Field(default=10, ge=1, le=50)
    rerank: bool = True
    scope_ids: tuple[str, ...] = ()
    source_ids: tuple[str, ...] = ()
    project_id: str | None = None
    workflow_id: str | None = None
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
    # Real memory_namespace rows visible to the request's own already-
    # validated scope_ids -- not embedded or ranked alongside hits (no
    # embedding step exists for memory statements), returned as an
    # honest, separate, unranked set of tenant knowledge facts.
    memory_facts: tuple[MemoryFact, ...]
    audited_at: datetime | None
