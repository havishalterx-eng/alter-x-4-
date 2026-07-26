"""Unit tests for PlannerKernel: decompose, replan, select_strategy."""

import json

import pytest
from pydantic import ValidationError

from src.ads_client.client import StubAdsClient
from src.planner.kernel import PlannerKernel, PlannerValidationError
from src.planner.llm_client import StubLlmClient
from src.planner.models import (
    DecomposeRequest,
    ReplanRequest,
    SelectStrategyRequest,
)
from src.planner.strategies import (
    STRATEGY_DIRECT,
    STRATEGY_ITERATIVE,
    STRATEGY_PLAN_THEN_EXECUTE,
)
from src.planner.task_skeleton import TaskSkeleton

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"


def _kernel() -> PlannerKernel:
    return PlannerKernel(ads_client=StubAdsClient(), llm_client=StubLlmClient())


def _decompose_req(**overrides: object) -> DecomposeRequest:
    defaults: dict[str, object] = {
        "tenant_id": TENANT_ID,
        "workspace_id": WORKSPACE_ID,
        "run_id": RUN_ID,
        "objective": "summarise customer feedback",
        "strategy": STRATEGY_ITERATIVE,
    }
    defaults.update(overrides)
    return DecomposeRequest(**defaults)  # type: ignore[arg-type]


def _replan_req(**overrides: object) -> ReplanRequest:
    stub_skeleton = TaskSkeleton(
        version="1",
        nodes=[],
        entry_point="node_stub_000",
    )
    # nodes is empty but entry_point is enough for validation test.
    defaults: dict[str, object] = {
        "tenant_id": TENANT_ID,
        "run_id": RUN_ID,
        "current_dag_json": stub_skeleton.to_json(),
        "failure_context_json": json.dumps({"error": "timeout", "node": "node_stub_000"}),
    }
    defaults.update(overrides)
    return ReplanRequest(**defaults)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Decompose
# ---------------------------------------------------------------------------


class TestDecompose:
    async def test_returns_valid_task_skeleton_json(self) -> None:
        kernel = _kernel()
        response = await kernel.decompose(_decompose_req())

        skeleton = TaskSkeleton.from_json(response.task_skeleton_json)
        assert skeleton.version == "1"
        assert len(skeleton.nodes) >= 1
        assert skeleton.entry_point

    async def test_ambiguity_false_for_short_objective_with_no_kb(self) -> None:
        kernel = _kernel()
        # Short objective (≤ 10 words) → no ambiguity even with empty KB.
        response = await kernel.decompose(_decompose_req(objective="run report"))

        assert response.ambiguity_detected is False
        assert response.clarification_questions == []

    async def test_ambiguity_true_for_long_objective_with_empty_kb(self) -> None:
        kernel = _kernel()
        # > 10 words + StubAdsClient always returns empty hits → ambiguity
        long_obj = " ".join(["word"] * 11)
        response = await kernel.decompose(_decompose_req(objective=long_obj))

        assert response.ambiguity_detected is True
        assert len(response.clarification_questions) >= 1

    async def test_rejects_malformed_tenant_id(self) -> None:
        with pytest.raises(ValidationError):
            _decompose_req(tenant_id="not-a-tenant")

    async def test_rejects_blank_objective(self) -> None:
        with pytest.raises(ValidationError):
            _decompose_req(objective="   ")

    async def test_rejects_malformed_run_id(self) -> None:
        with pytest.raises(ValidationError):
            _decompose_req(run_id="bad_id")


# ---------------------------------------------------------------------------
# Replan
# ---------------------------------------------------------------------------


class TestReplan:
    async def test_returns_revised_skeleton_and_reason(self) -> None:
        kernel = _kernel()
        response = await kernel.replan(_replan_req())

        skeleton = TaskSkeleton.from_json(response.revised_skeleton_json)
        assert skeleton.version == "1"
        assert response.reason

    async def test_preserves_node_structure_in_stub(self) -> None:
        from src.planner.task_skeleton import TaskNode

        original = TaskSkeleton(
            version="1",
            nodes=[TaskNode(key="node_a", type="llm", config={}, depends_on=[])],
            entry_point="node_a",
        )
        kernel = _kernel()
        response = await kernel.replan(
            _replan_req(current_dag_json=original.to_json())
        )

        revised = TaskSkeleton.from_json(response.revised_skeleton_json)
        assert revised.entry_point == "node_a"

    async def test_raises_validation_error_on_invalid_dag_json(self) -> None:
        kernel = _kernel()
        with pytest.raises(PlannerValidationError, match="current_dag_json"):
            await kernel.replan(_replan_req(current_dag_json='{"broken": true}'))

    async def test_raises_validation_error_on_invalid_failure_context_json(self) -> None:
        kernel = _kernel()
        with pytest.raises(PlannerValidationError, match="failure_context_json"):
            await kernel.replan(_replan_req(failure_context_json="not json {{"))

    async def test_rejects_malformed_tenant_id(self) -> None:
        with pytest.raises(ValidationError):
            _replan_req(tenant_id="bad")


# ---------------------------------------------------------------------------
# SelectStrategy
# ---------------------------------------------------------------------------


class TestSelectStrategy:
    async def test_project_mode_returns_plan_then_execute(self) -> None:
        kernel = _kernel()
        response = await kernel.select_strategy(
            SelectStrategyRequest(
                tenant_id=TENANT_ID,
                objective="build a new product",
                mode="project",
            )
        )

        assert response.strategy == STRATEGY_PLAN_THEN_EXECUTE
        assert response.reason

    async def test_workflow_simple_returns_direct(self) -> None:
        kernel = _kernel()
        response = await kernel.select_strategy(
            SelectStrategyRequest(
                tenant_id=TENANT_ID,
                objective="run test",
                mode="workflow",
            )
        )

        assert response.strategy == STRATEGY_DIRECT

    async def test_workflow_complex_returns_iterative(self) -> None:
        kernel = _kernel()
        response = await kernel.select_strategy(
            SelectStrategyRequest(
                tenant_id=TENANT_ID,
                objective="generate a detailed monthly report",
                mode="workflow",
            )
        )

        assert response.strategy == STRATEGY_ITERATIVE

    async def test_unknown_mode_returns_iterative(self) -> None:
        kernel = _kernel()
        response = await kernel.select_strategy(
            SelectStrategyRequest(
                tenant_id=TENANT_ID,
                objective="do something",
                mode="banana",
            )
        )

        assert response.strategy == STRATEGY_ITERATIVE

    async def test_rejects_blank_objective(self) -> None:
        with pytest.raises(ValidationError):
            SelectStrategyRequest(tenant_id=TENANT_ID, objective="", mode="workflow")

    async def test_rejects_malformed_tenant_id(self) -> None:
        with pytest.raises(ValidationError):
            SelectStrategyRequest(
                tenant_id="bad",
                objective="do something",
                mode="workflow",
            )
