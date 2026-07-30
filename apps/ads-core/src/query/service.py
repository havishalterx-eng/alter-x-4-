from src.ingestion.embedding_client import EmbeddingClient

from .models import RetrievalRequest, RetrievalResponse
from .repository import SqlAlchemyRetrievalRepository


class RetrievalService:
    def __init__(
        self, *, repository: SqlAlchemyRetrievalRepository, embeddings: EmbeddingClient
    ) -> None:
        self._repository = repository
        self._embeddings = embeddings

    def retrieve(self, request: RetrievalRequest) -> RetrievalResponse:
        result = self._repository.retrieve(
            request,
            self._embeddings.embed(
                tenant_id=request.tenant_id, text=request.query, dimensions=1024
            ).vector,
        )
        return RetrievalResponse(hits=result.hits, audited_at=result.audited_at)

    def provenance(self, *, tenant_id: str, document_id: str) -> dict[str, object] | None:
        return self._repository.provenance(tenant_id=tenant_id, document_id=document_id)
