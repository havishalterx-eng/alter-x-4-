"""Planning-phase exit check 4: a minimal, real, executable golden set.

This is NOT Hardening's future golden set (HARD-2 owns the 20-case,
threshold-graded planner golden set against real thresholds). This is a
small, real, deterministic set of objective -> expected-outcome cases
proving the mechanism itself is executable: select_strategy's four real
strategies, and PlannerKernel.decompose's real ambiguity heuristic. Runs
against the real StubAdsClient/StubLlmClient (no live Bedrock/Anthropic
credentials in this sandbox), same as every other planner test in this
suite.
"""

import pytest

from src.ads_client.client import StubAdsClient
from src.planner.kernel import PlannerKernel
from src.planner.llm_client import StubLlmClient
from src.planner.models import DecomposeRequest, SelectStrategyRequest
from src.planner.strategies import (
    STRATEGY_DIRECT,
    STRATEGY_ITERATIVE,
    STRATEGY_MANAGER_WORKER,
    STRATEGY_PLAN_THEN_EXECUTE,
)
from src.problem_understanding.models import ProblemSpec

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"

_MANAGER_WORKER_OBJECTIVE = (
    "Coordinate every team across all regions to migrate the legacy database, "
    "deploy the new services, review each configuration file, research "
    "compliance needs, design a rollback plan, generate documentation, "
    "create test suites, compile results, and produce a final summary "
    "report for stakeholders next quarter"
)


def _kernel() -> PlannerKernel:
    return PlannerKernel(ads_client=StubAdsClient(), llm_client=StubLlmClient())


STRATEGY_GOLDEN_SET = [
    pytest.param("Fix a typo in the readme", "workflow", STRATEGY_DIRECT, id="direct"),
    pytest.param(
        "Coordinate a deployment across several regions",
        "workflow",
        STRATEGY_ITERATIVE,
        id="iterative",
    ),
    pytest.param(
        "Build me a small app",
        "project",
        STRATEGY_PLAN_THEN_EXECUTE,
        id="plan_then_execute",
    ),
    pytest.param(
        _MANAGER_WORKER_OBJECTIVE,
        "workflow",
        STRATEGY_MANAGER_WORKER,
        id="manager_worker",
    ),
]


class TestPlannerGoldenSetStrategySelection:
    @pytest.mark.parametrize("objective, mode, expected_strategy", STRATEGY_GOLDEN_SET)
    @pytest.mark.asyncio
    async def test_select_strategy_matches_expected(
        self, objective: str, mode: str, expected_strategy: str
    ) -> None:
        kernel = _kernel()
        response = await kernel.select_strategy(
            SelectStrategyRequest(tenant_id=TENANT_ID, objective=objective, mode=mode)
        )
        assert response.strategy == expected_strategy


AMBIGUITY_GOLDEN_SET = [
    pytest.param(
        "Please handle the quarterly project the way we discussed before without further detail",
        True,
        id="ambiguous_long_objective_zero_kb_hits",
    ),
    pytest.param(
        "Summarize this document quickly",
        False,
        id="unambiguous_short_objective",
    ),
]


class TestPlannerGoldenSetAmbiguityDetection:
    @pytest.mark.parametrize("objective, expected_ambiguity", AMBIGUITY_GOLDEN_SET)
    @pytest.mark.asyncio
    async def test_decompose_ambiguity_matches_expected(
        self, objective: str, expected_ambiguity: bool
    ) -> None:
        kernel = _kernel()
        response = await kernel.decompose(
            DecomposeRequest(
                tenant_id=TENANT_ID,
                workspace_id=WORKSPACE_ID,
                run_id=RUN_ID,
                strategy=STRATEGY_ITERATIVE,
                problem_spec_json=ProblemSpec(
                    objective=objective,
                    missing_information=["scope"] if expected_ambiguity else [],
                ).model_dump_json(),
            )
        )
        assert response.ambiguity_detected is expected_ambiguity
