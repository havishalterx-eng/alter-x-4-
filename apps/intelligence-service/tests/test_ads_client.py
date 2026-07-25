import pytest
from pydantic import ValidationError

from src.ads_client import (
    GetProvenanceRequest,
    RerankRequest,
    RetrievalHit,
    RetrieveRequest,
    StubAdsClient,
)
from src.ads_client.client import AdsDocumentNotFoundError

VALID_TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
VALID_WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
VALID_DOCUMENT_ID = "doc_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
VALID_SCOPE_ID = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"


def _retrieve_request(**overrides: object) -> RetrieveRequest:
    defaults: dict[str, object] = {
        "tenant_id": VALID_TENANT_ID,
        "workspace_id": VALID_WORKSPACE_ID,
        "query": "what is our refund policy",
        "scope_ids": [VALID_SCOPE_ID],
        "top_k": 5,
    }
    defaults.update(overrides)
    return RetrieveRequest(**defaults)  # type: ignore[arg-type]


class TestRetrieveRequestValidation:
    def test_accepts_valid_ids(self) -> None:
        request = _retrieve_request()

        assert request.tenant_id == VALID_TENANT_ID
        assert request.scope_ids == [VALID_SCOPE_ID]

    def test_rejects_malformed_tenant_id(self) -> None:
        with pytest.raises(ValidationError):
            _retrieve_request(tenant_id="not-a-tenant-id")

    def test_rejects_malformed_workspace_id(self) -> None:
        with pytest.raises(ValidationError):
            _retrieve_request(workspace_id="ws_not-a-uuid")

    def test_rejects_malformed_scope_id(self) -> None:
        with pytest.raises(ValidationError):
            _retrieve_request(scope_ids=["totally-invalid"])

    def test_rejects_negative_top_k(self) -> None:
        with pytest.raises(ValidationError):
            _retrieve_request(top_k=-1)

    def test_defaults_scope_ids_to_empty_list(self) -> None:
        request = RetrieveRequest(
            tenant_id=VALID_TENANT_ID,
            workspace_id=VALID_WORKSPACE_ID,
            query="q",
            top_k=1,
        )

        assert request.scope_ids == []


class TestGetProvenanceRequestValidation:
    def test_rejects_malformed_document_id(self) -> None:
        with pytest.raises(ValidationError):
            GetProvenanceRequest(tenant_id=VALID_TENANT_ID, document_id="not-a-doc-id")


class TestStubAdsClient:
    async def test_retrieve_always_returns_empty_hits(self) -> None:
        client = StubAdsClient()

        response = await client.retrieve(_retrieve_request())

        assert response.hits == []

    async def test_rerank_always_returns_empty_hits_even_with_candidates(self) -> None:
        client = StubAdsClient()
        candidate = RetrievalHit(
            document_id=VALID_DOCUMENT_ID,
            chunk_reference="chunk-1",
            score=0.9,
            confidence=0.9,
            provenance_json="{}",
        )
        request = RerankRequest(
            tenant_id=VALID_TENANT_ID,
            workspace_id=VALID_WORKSPACE_ID,
            query="q",
            candidates=[candidate],
        )

        response = await client.rerank(request)

        assert response.hits == []

    async def test_get_provenance_fails_closed_with_document_id(self) -> None:
        client = StubAdsClient()
        request = GetProvenanceRequest(
            tenant_id=VALID_TENANT_ID, document_id=VALID_DOCUMENT_ID
        )

        with pytest.raises(AdsDocumentNotFoundError) as exc_info:
            await client.get_provenance(request)

        assert exc_info.value.document_id == VALID_DOCUMENT_ID
