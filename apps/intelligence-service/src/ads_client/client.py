"""The ADS Client -- the only path from the Planner into ADS Q.

`GrpcAdsClient` is the production implementation. It preserves the Planning
interface while translating it to the locked ADS Q protobuf contract.
"""

from typing import Any, Protocol

from src.ads_client.models import (
    GetProvenanceRequest,
    GetProvenanceResponse,
    RerankRequest,
    RerankResponse,
    RetrievalHit,
    RetrieveRequest,
    RetrieveResponse,
)


class AdsDocumentNotFoundError(Exception):
    """Raised when GetProvenance is asked about a document ADS Q has no record of."""

    def __init__(self, document_id: str) -> None:
        super().__init__(f"No provenance record for document_id={document_id}")
        self.document_id = document_id


class AdsUnavailableError(RuntimeError):
    """ADS Q could not answer a provenance or reranking request."""


class AdsClient(Protocol):
    """The Engine-side interface to ADS Q. Planner depends on this, never on a concrete impl."""

    async def retrieve(self, request: RetrieveRequest) -> RetrieveResponse: ...

    async def rerank(self, request: RerankRequest) -> RerankResponse: ...

    async def get_provenance(self, request: GetProvenanceRequest) -> GetProvenanceResponse: ...


class StubAdsClient:
    """Contract-complete ADS Client that always reports an empty knowledge base."""

    async def retrieve(self, request: RetrieveRequest) -> RetrieveResponse:
        return RetrieveResponse(hits=[])

    async def rerank(self, request: RerankRequest) -> RerankResponse:
        return RerankResponse(hits=[])

    async def get_provenance(self, request: GetProvenanceRequest) -> GetProvenanceResponse:
        raise AdsDocumentNotFoundError(request.document_id)


class GrpcAdsClient:
    """ADS Q client that degrades retrieval safely without changing Planning APIs."""

    def __init__(
        self,
        target: str,
        *,
        timeout_seconds: float = 3.0,
        channel: Any | None = None,
    ) -> None:
        grpc, adsq_pb2, adsq_pb2_grpc = _load_grpc_bindings()
        self._timeout_seconds = timeout_seconds
        self._grpc = grpc
        self._adsq_pb2 = adsq_pb2
        self._channel = channel or grpc.aio.insecure_channel(target)
        self._stub = adsq_pb2_grpc.AdsqServiceStub(self._channel)

    async def close(self) -> None:
        await self._channel.close()

    async def retrieve(self, request: RetrieveRequest) -> RetrieveResponse:
        try:
            response = await self._stub.Retrieve(
                self._adsq_pb2.RetrieveRequest(
                    tenant_id=request.tenant_id,
                    workspace_id=request.workspace_id,
                    query=request.query,
                    scope_ids=request.scope_ids,
                    top_k=request.top_k,
                    metadata_filter_json="{}",
                    requester="intelligence-service",
                ),
                timeout=self._timeout_seconds,
            )
        except self._grpc.aio.AioRpcError:
            # The locked Planning request has no authorized scope inputs yet.
            # Empty context is safer than broadening the ADS Q request.
            return RetrieveResponse(hits=[])
        return RetrieveResponse(hits=[_hit_from_proto(hit) for hit in response.hits])

    async def rerank(self, request: RerankRequest) -> RerankResponse:
        try:
            response = await self._stub.Rerank(
                self._adsq_pb2.RerankRequest(
                    tenant_id=request.tenant_id,
                    workspace_id=request.workspace_id,
                    query=request.query,
                    candidates=[
                        _hit_to_proto(hit, self._adsq_pb2) for hit in request.candidates
                    ],
                ),
                timeout=self._timeout_seconds,
            )
        except self._grpc.aio.AioRpcError as exc:
            raise AdsUnavailableError("ADS Q reranking is unavailable") from exc
        return RerankResponse(hits=[_hit_from_proto(hit) for hit in response.hits])

    async def get_provenance(self, request: GetProvenanceRequest) -> GetProvenanceResponse:
        try:
            response = await self._stub.GetProvenance(
                self._adsq_pb2.GetProvenanceRequest(
                    tenant_id=request.tenant_id, document_id=request.document_id
                ),
                timeout=self._timeout_seconds,
            )
        except self._grpc.aio.AioRpcError as exc:
            if exc.code() == self._grpc.StatusCode.NOT_FOUND:
                raise AdsDocumentNotFoundError(request.document_id) from exc
            raise AdsUnavailableError("ADS Q provenance is unavailable") from exc
        return GetProvenanceResponse(
            provenance_json=response.provenance_json, confidence=response.confidence
        )


def _load_grpc_bindings() -> tuple[Any, Any, Any]:
    """Defer the optional transport imports until the production client starts."""
    try:
        import grpc

        from alter.adsq.v1 import adsq_pb2, adsq_pb2_grpc
    except ModuleNotFoundError as exc:
        raise RuntimeError("GrpcAdsClient requires the intelligence-service dependencies") from exc
    return grpc, adsq_pb2, adsq_pb2_grpc


def _hit_from_proto(hit: Any) -> RetrievalHit:
    return RetrievalHit(
        document_id=hit.document_id,
        chunk_reference=hit.chunk_reference,
        score=hit.score,
        confidence=hit.confidence,
        provenance_json=hit.provenance_json,
    )


def _hit_to_proto(hit: RetrievalHit, adsq_pb2: Any) -> Any:
    return adsq_pb2.RetrievalHit(
        document_id=hit.document_id,
        chunk_reference=hit.chunk_reference,
        score=hit.score,
        confidence=hit.confidence,
        provenance_json=hit.provenance_json,
    )
