"""The ADS Client -- the only path from the Planner into ADS Q.

`StubAdsClient` is a placeholder implementation used while the Knowledge
phase (ADS Core + ADS Q) has not shipped yet. It is contract-complete: its
method signatures and message shapes match
packages/contracts/proto/alter/adsq/v1/adsq.proto exactly, so the Planner
can be built and tested against `AdsClient` today and swapped onto a real
gRPC-backed implementation later with no caller-side changes.

The stub never fabricates knowledge-base content. It always reports an
empty result set rather than guessing, and it fails closed (raises) on
`get_provenance` for any document, since with an empty KB no document can
legitimately have provenance -- returning a fake low-confidence answer would
be more dangerous to a caller than a clear error.
"""

from typing import Protocol

from src.ads_client.models import (
    GetProvenanceRequest,
    GetProvenanceResponse,
    RerankRequest,
    RerankResponse,
    RetrieveRequest,
    RetrieveResponse,
)


class AdsDocumentNotFoundError(Exception):
    """Raised when GetProvenance is asked about a document ADS Q has no record of."""

    def __init__(self, document_id: str) -> None:
        super().__init__(f"No provenance record for document_id={document_id}")
        self.document_id = document_id


class AdsClient(Protocol):
    """The Engine-side interface to ADS Q. Planner depends on this, never on a concrete impl."""

    async def retrieve(self, request: RetrieveRequest) -> RetrieveResponse: ...

    async def rerank(self, request: RerankRequest) -> RerankResponse: ...

    async def get_provenance(
        self, request: GetProvenanceRequest
    ) -> GetProvenanceResponse: ...


class StubAdsClient:
    """Contract-complete ADS Client that always reports an empty knowledge base."""

    async def retrieve(self, request: RetrieveRequest) -> RetrieveResponse:
        return RetrieveResponse(hits=[])

    async def rerank(self, request: RerankRequest) -> RerankResponse:
        return RerankResponse(hits=[])

    async def get_provenance(
        self, request: GetProvenanceRequest
    ) -> GetProvenanceResponse:
        raise AdsDocumentNotFoundError(request.document_id)
