from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.ads_client.models import (
    GetProvenanceRequest,
    GetProvenanceResponse,
    RerankRequest,
    RerankResponse,
    RetrievalHit,
    RetrieveRequest,
    RetrieveResponse,
)
from src.problem_understanding.kernel import (
    ProblemUnderstandingExecutionError,
    ProblemUnderstandingKernel,
)
from src.problem_understanding.models import ProblemSpec, ProblemUnderstandingRequest

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
DOCUMENT_ID = "doc_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"


class RecordingAdsClient:
    def __init__(self, hits: list[RetrievalHit]) -> None:
        self.hits = hits
        self.request: RetrieveRequest | None = None

    async def retrieve(self, request: RetrieveRequest) -> RetrieveResponse:
        self.request = request
        return RetrieveResponse(hits=self.hits)

    async def rerank(self, request: RerankRequest) -> RerankResponse:
        return RerankResponse(hits=request.candidates)

    async def get_provenance(self, request: GetProvenanceRequest) -> GetProvenanceResponse:
        raise AssertionError(f"Unexpected provenance lookup for {request.document_id}")


class ReturningLlmClient:
    def __init__(self) -> None:
        self.kb_context = ""

    async def generate_problem_spec(self, **kwargs: object) -> ProblemSpec:
        self.kb_context = str(kwargs["kb_context"])
        return ProblemSpec(
            objective="model wording must not replace request",
            current_situation="Refund approvals are currently delayed.",
            actors=["support manager"],
            systems_involved=["support desk"],
            constraints=["Do not expose customer payment data."],
            required_data=["open refund cases"],
            risk="medium",
            missing_information=["Approval threshold is not supplied."],
            success_criteria=["Refund response time is reported by queue."],
        )


def _request(**overrides: object) -> ProblemUnderstandingRequest:
    values: dict[str, object] = {
        "tenant_id": TENANT_ID,
        "workspace_id": WORKSPACE_ID,
        "run_id": RUN_ID,
        "objective": "Reduce delayed customer refund approvals.",
        "actor_context": {"role": "support manager"},
    }
    values.update(overrides)
    return ProblemUnderstandingRequest(**values)  # type: ignore[arg-type]


def _hit() -> RetrievalHit:
    return RetrievalHit(
        document_id=DOCUMENT_ID,
        chunk_reference="refund-policy-v4#approval-sla",
        score=0.91,
        confidence=0.88,
        provenance_json='{"system":"support-desk","policy":"refund-v4"}',
    )


async def test_understand_uses_scoped_ads_context_and_returns_full_problem_spec() -> None:
    ads = RecordingAdsClient([_hit()])
    llm = ReturningLlmClient()
    response = await ProblemUnderstandingKernel(ads, llm).understand(_request())

    assert ads.request == RetrieveRequest(
        tenant_id=TENANT_ID,
        workspace_id=WORKSPACE_ID,
        query="Reduce delayed customer refund approvals.",
        top_k=5,
    )
    assert response.objective == "Reduce delayed customer refund approvals."
    assert response.current_situation == "Refund approvals are currently delayed."
    assert response.constraints == ["Do not expose customer payment data."]
    assert response.context_references[0].document_id == DOCUMENT_ID
    assert "refund-policy-v4" in llm.kb_context


async def test_understand_degrades_honestly_when_ads_has_no_context() -> None:
    response = await ProblemUnderstandingKernel(RecordingAdsClient([])).understand(_request())

    assert response.objective == "Reduce delayed customer refund approvals."
    assert response.actors == ["support manager"]
    assert response.context_references == []
    assert response.risk == "unknown"
    assert (
        response.missing_information[0]
        == "No verified ADS context was retrieved for this objective."
    )


async def test_llm_failure_is_visible_not_converted_to_fabricated_problem_spec() -> None:
    class FailingLlmClient:
        async def generate_problem_spec(self, **kwargs: object) -> ProblemSpec:
            raise ConnectionError("Model Gateway unavailable")

    with pytest.raises(ProblemUnderstandingExecutionError, match="Model Gateway"):
        await ProblemUnderstandingKernel(RecordingAdsClient([]), FailingLlmClient()).understand(
            _request()
        )


@pytest.mark.parametrize("objective", ["", "   "])
def test_rejects_empty_objective(objective: str) -> None:
    with pytest.raises(ValidationError, match="objective"):
        _request(objective=objective)


def test_rejects_invalid_tenant_id() -> None:
    with pytest.raises(ValidationError, match="tenant_id"):
        _request(tenant_id="not-a-tenant")
