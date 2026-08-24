"""Integration tests for the verification FastAPI router.

Uses httpx.AsyncClient against the real app (no mocking) to verify that:
- Routes exist and return correct HTTP status codes.
- Valid request bodies produce well-formed responses.
- Invalid bodies produce 422 (Pydantic validation).
"""

from collections.abc import Generator

import pytest
from httpx import ASGITransport, AsyncClient

from src.main import app
from src.verification.kernel import VerificationKernel
from src.verification.llm_client import StubReviewerLlmClient
from src.verification.router import get_kernel

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"


@pytest.fixture
def kernel() -> VerificationKernel:
    return VerificationKernel(llm_client=StubReviewerLlmClient())


@pytest.fixture
def client(kernel: VerificationKernel) -> AsyncClient:
    app.dependency_overrides[get_kernel] = lambda: kernel
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"authorization": "Bearer integration-token"},
    )


@pytest.fixture(autouse=True)
def _clear_overrides() -> Generator[None, None, None]:
    yield
    app.dependency_overrides.clear()


def _payload(node_type: str, output_json: str = '{"result": "ok"}') -> dict[str, str]:
    return {
        "tenant_id": TENANT_ID,
        "run_id": RUN_ID,
        "node_execution_id": NODE_EXECUTION_ID,
        "node_key": "node_a",
        "node_type": node_type,
        "config_json": "{}",
        "output_json": output_json,
    }


class TestHealth:
    async def test_health_ok(self, client: AsyncClient) -> None:
        response = await client.get("/health")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestScoreNodeRoute:
    async def test_content_bearing_node_returns_200(self, client: AsyncClient) -> None:
        response = await client.post("/verification/score-node", json=_payload("LLMTask"))

        assert response.status_code == 200
        body = response.json()
        assert body["verdict"] == "pass"
        assert body["reviewer_model"] == "ADVANCED"
        assert 0.0 <= body["score"] <= 1.0

    async def test_deterministic_node_returns_200(self, client: AsyncClient) -> None:
        response = await client.post(
            "/verification/score-node", json=_payload("Gate", output_json='{"routed": true}')
        )

        assert response.status_code == 200
        body = response.json()
        assert body["verdict"] == "pass"
        assert body["reviewer_model"] == "deterministic"

    async def test_missing_node_type_returns_422(self, client: AsyncClient) -> None:
        payload = _payload("LLMTask")
        del payload["node_type"]

        response = await client.post("/verification/score-node", json=payload)

        assert response.status_code == 422

    async def test_invalid_tenant_id_returns_422(self, client: AsyncClient) -> None:
        payload = _payload("LLMTask")
        payload["tenant_id"] = "not-a-tenant-id"

        response = await client.post("/verification/score-node", json=payload)

        assert response.status_code == 422

    async def test_blank_node_key_returns_422(self, client: AsyncClient) -> None:
        payload = _payload("LLMTask")
        payload["node_key"] = "   "

        response = await client.post("/verification/score-node", json=payload)

        assert response.status_code == 422
