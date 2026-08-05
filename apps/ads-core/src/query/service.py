from threading import BoundedSemaphore

from src.ingestion.embedding_client import EmbeddingClient

from .models import RetrievalRequest, RetrievalResponse
from .quality import rerank_and_reconstruct
from .repository import ScopeViolationError, SqlAlchemyRetrievalRepository


class RetrievalBackpressureError(RuntimeError):
    """All ADS Q retrieval slots are busy."""


class RetrievalService:
    def __init__(
        self,
        *,
        repository: SqlAlchemyRetrievalRepository,
        embeddings: EmbeddingClient,
        max_concurrency: int = 16,
    ) -> None:
        self._repository = repository
        self._embeddings = embeddings
        self._slots = BoundedSemaphore(max_concurrency)

    def retrieve(self, request: RetrievalRequest) -> RetrievalResponse:
        try:
            self._repository.validate_scopes(request)
        except ScopeViolationError:
            self._repository.audit(request, outcome="rejected", failure_reason="scope_unavailable")
            raise
        if not self._slots.acquire(blocking=False):
            self._repository.audit(
                request, outcome="backpressured", failure_reason="concurrency_limit"
            )
            raise RetrievalBackpressureError("ADS Q is at capacity; retry shortly")
        try:
            candidates = self._repository.retrieve(
                request,
                self._embeddings.embed(
                    tenant_id=request.tenant_id, text=request.query, dimensions=1024
                ).vector,
            ).hits
            hits = rerank_and_reconstruct(candidates) if request.rerank else candidates
            audited_at = self._repository.audit(
                request, candidates=candidates, results=hits, outcome="succeeded"
            )
            return RetrievalResponse(hits=hits, audited_at=audited_at)
        except Exception:
            self._repository.audit(request, outcome="failed", failure_reason="retrieval_failed")
            raise
        finally:
            self._slots.release()

    def provenance(self, *, tenant_id: str, document_id: str) -> dict[str, object] | None:
        return self._repository.provenance(tenant_id=tenant_id, document_id=document_id)
