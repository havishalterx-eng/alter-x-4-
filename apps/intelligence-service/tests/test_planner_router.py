"""Integration tests for the planner FastAPI router.

Uses httpx.AsyncClient against the real app (no mocking) to verify that:
- Routes exist and return correct HTTP status codes.
- Valid request bodies produce well-formed responses.
- Invalid bodies produce 422 (Pydantic validation) or 422 (kernel validation).
"""

import json
from collections.abc import Generator

import pytest
from httpx import ASGITransport, AsyncClient

from src.ads_client.client import StubAdsClient
from src.main import app
from src.planner.kernel import PlannerKernel
from src.planner.llm_client import StubLlmClient
from src.planner.router import get_kernel
from src.planner.strategies import (
    STRATEGY_DIRECT,
    STRATEGY_ITERATIVE,
    STRATEGY_PLAN_THEN_EXECUTE,
)
from src.planner.task_skeleton import TaskSkeleton
from src.problem_understanding.models import ProblemSpec

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"

_STUB_SKELETON_JSON = TaskSkeleton(
    version="1",
    nodes=[],
    entry_point="node_stub_000",
).to_json()


def _problem_spec_json(objective: str = "summarise feedback") -> str:
    return ProblemSpec(objective=objective).model_dump_json()


@pytest.fixture
def kernel() -> PlannerKernel:
    return PlannerKernel(ads_client=StubAdsClient(), llm_client=StubLlmClient())


@pytest.fixture
def client(kernel: PlannerKernel) -> AsyncClient:
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


# ---------------------------------------------------------------------------
# Health smoke-test
# ---------------------------------------------------------------------------


class TestHealth:
    async def test_health_ok(self, client: AsyncClient) -> None:
        response = await client.get("/health")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# POST /planner/decompose
# ---------------------------------------------------------------------------


class TestDecomposeRoute:
    async def test_valid_request_returns_200(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "workspace_id": WORKSPACE_ID,
            "run_id": RUN_ID,
            "problem_spec_json": _problem_spec_json(),
            "strategy": "iterative",
        }
        response = await client.post("/planner/decompose", json=payload)

        assert response.status_code == 200
        body = response.json()
        assert "task_skeleton_json" in body
        assert isinstance(body["ambiguity_detected"], bool)
        assert isinstance(body["clarification_questions"], list)

    async def test_skeleton_json_is_parseable(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "workspace_id": WORKSPACE_ID,
            "run_id": RUN_ID,
            "problem_spec_json": _problem_spec_json("run test suite"),
            "strategy": "direct",
        }
        response = await client.post("/planner/decompose", json=payload)

        skeleton = TaskSkeleton.from_json(response.json()["task_skeleton_json"])
        assert skeleton.entry_point

    async def test_missing_objective_returns_422(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "workspace_id": WORKSPACE_ID,
            "run_id": RUN_ID,
            "strategy": "direct",
        }
        response = await client.post("/planner/decompose", json=payload)

        assert response.status_code == 422

    async def test_malformed_problem_spec_returns_422_before_model_call(
        self, client: AsyncClient
    ) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "workspace_id": WORKSPACE_ID,
            "run_id": RUN_ID,
            "strategy": "direct",
            "problem_spec_json": "not json",
        }
        response = await client.post("/planner/decompose", json=payload)

        assert response.status_code == 422

    async def test_malformed_tenant_id_returns_422(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": "bad-id",
            "workspace_id": WORKSPACE_ID,
            "run_id": RUN_ID,
            "problem_spec_json": _problem_spec_json("do something"),
            "strategy": "direct",
        }
        response = await client.post("/planner/decompose", json=payload)

        assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /planner/replan
# ---------------------------------------------------------------------------


class TestReplanRoute:
    async def test_valid_request_returns_200(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "run_id": RUN_ID,
            "current_dag_json": _STUB_SKELETON_JSON,
            "failure_context_json": json.dumps({"error": "timeout"}),
        }
        response = await client.post("/planner/replan", json=payload)

        assert response.status_code == 200
        body = response.json()
        assert "revised_skeleton_json" in body
        assert "reason" in body

    async def test_invalid_dag_json_returns_422(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "run_id": RUN_ID,
            "current_dag_json": '{"totally": "wrong"}',
            "failure_context_json": json.dumps({"error": "x"}),
        }
        response = await client.post("/planner/replan", json=payload)

        assert response.status_code == 422

    async def test_invalid_failure_context_json_returns_422(
        self, client: AsyncClient
    ) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "run_id": RUN_ID,
            "current_dag_json": _STUB_SKELETON_JSON,
            "failure_context_json": "not {{ json",
        }
        response = await client.post("/planner/replan", json=payload)

        assert response.status_code == 422


# ---------------------------------------------------------------------------
# POST /planner/select-strategy
# ---------------------------------------------------------------------------


class TestSelectStrategyRoute:
    async def test_project_mode_returns_plan_then_execute(
        self, client: AsyncClient
    ) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "objective": "launch new product line",
            "mode": "project",
        }
        response = await client.post("/planner/select-strategy", json=payload)

        assert response.status_code == 200
        assert response.json()["strategy"] == STRATEGY_PLAN_THEN_EXECUTE

    async def test_workflow_simple_returns_direct(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "objective": "ping server",
            "mode": "workflow",
        }
        response = await client.post("/planner/select-strategy", json=payload)

        assert response.status_code == 200
        assert response.json()["strategy"] == STRATEGY_DIRECT

    async def test_workflow_complex_returns_iterative(
        self, client: AsyncClient
    ) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "objective": "generate and deploy a batch report",
            "mode": "workflow",
        }
        response = await client.post("/planner/select-strategy", json=payload)

        assert response.status_code == 200
        assert response.json()["strategy"] == STRATEGY_ITERATIVE

    async def test_blank_objective_returns_422(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "objective": "",
            "mode": "workflow",
        }
        response = await client.post("/planner/select-strategy", json=payload)

        assert response.status_code == 422

    async def test_response_contains_reason(self, client: AsyncClient) -> None:
        payload = {
            "tenant_id": TENANT_ID,
            "objective": "do something",
            "mode": "project",
        }
        response = await client.post("/planner/select-strategy", json=payload)

        assert response.json()["reason"]
