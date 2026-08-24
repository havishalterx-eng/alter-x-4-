"""App-level coverage for the private Problem Understanding route."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.problem_understanding.kernel import ProblemUnderstandingExecutionError
from src.problem_understanding.models import ProblemSpec, ProblemUnderstandingRequest
from src.problem_understanding.router import (
    get_kernel,
    problem_understanding_lifespan,
)

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "tenant_id": TENANT_ID,
        "workspace_id": WORKSPACE_ID,
        "run_id": RUN_ID,
        "objective": "Reduce delayed customer refund approvals.",
        "actor_context": {"role": "support manager"},
    }
    payload.update(overrides)
    return payload


class RecordingKernel:
    def __init__(self) -> None:
        self.request: ProblemUnderstandingRequest | None = None

    async def understand(self, request: ProblemUnderstandingRequest) -> ProblemSpec:
        self.request = request
        return ProblemSpec(
            objective=request.objective,
            actors=["support manager"],
            risk="unknown",
            missing_information=["No verified ADS context was retrieved for this objective."],
        )


@pytest.fixture
def kernel() -> RecordingKernel:
    return RecordingKernel()


@pytest.fixture
def client(kernel: RecordingKernel) -> AsyncClient:
    app.dependency_overrides[get_kernel] = lambda: kernel
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test", headers={"authorization": "Bearer integration-token"})


@pytest.fixture(autouse=True)
def _clear_overrides() -> Generator[None, None, None]:
    yield
    app.dependency_overrides.clear()


async def test_understand_returns_typed_problem_spec_and_preserves_request_ids(
    client: AsyncClient, kernel: RecordingKernel
) -> None:
    response = await client.post("/internal/problem-understanding/understand", json=_payload())

    assert response.status_code == 200
    assert response.json()["objective"] == "Reduce delayed customer refund approvals."
    assert kernel.request is not None
    assert kernel.request.tenant_id == TENANT_ID
    assert kernel.request.workspace_id == WORKSPACE_ID
    assert kernel.request.run_id == RUN_ID


async def test_understand_rejects_malformed_request_without_calling_kernel(
    client: AsyncClient, kernel: RecordingKernel
) -> None:
    response = await client.post(
        "/internal/problem-understanding/understand", json=_payload(objective=" ")
    )

    assert response.status_code == 422
    assert kernel.request is None


async def test_understand_surfaces_execution_failure_without_problem_spec(
    client: AsyncClient,
) -> None:
    class FailingKernel:
        async def understand(self, request: ProblemUnderstandingRequest) -> ProblemSpec:
            del request
            raise ProblemUnderstandingExecutionError(
                "Model Gateway could not produce a ProblemSpec"
            )

    app.dependency_overrides[get_kernel] = FailingKernel
    response = await client.post("/internal/problem-understanding/understand", json=_payload())

    assert response.status_code == 503
    assert response.json()["detail"] == "Model Gateway could not produce a ProblemSpec"
    assert "objective" not in response.json()


async def test_lifespan_closes_owned_resources_once_and_clears_kernel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ClosingAdsClient:
        close_calls = 0

        def __init__(self, *args: object, **kwargs: object) -> None:
            del args, kwargs

        async def close(self) -> None:
            type(self).close_calls += 1

    class ClosingLlmClient:
        close_calls = 0

        def __init__(self, *args: object, **kwargs: object) -> None:
            del args, kwargs

        async def close(self) -> None:
            type(self).close_calls += 1

    monkeypatch.setattr("src.ads_client.client.GrpcAdsClient", ClosingAdsClient)
    monkeypatch.setattr(
        "src.problem_understanding.router.ModelGatewayProblemUnderstandingClient",
        ClosingLlmClient,
    )

    async with problem_understanding_lifespan(FastAPI()):
        assert isinstance(get_kernel()._ads, ClosingAdsClient)
        assert isinstance(get_kernel()._llm, ClosingLlmClient)

    assert ClosingAdsClient.close_calls == 1
    assert ClosingLlmClient.close_calls == 1
    with pytest.raises(RuntimeError, match="not initialised"):
        get_kernel()
