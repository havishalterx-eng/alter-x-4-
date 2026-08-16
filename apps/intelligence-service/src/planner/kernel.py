"""Planner kernel: core planning logic.

Implements the three operations exposed by alter.planner.v1.PlannerService:
  - decompose        -- objective → task skeleton + ambiguity signal
  - replan           -- failure context → revised skeleton
  - select_strategy  -- objective + mode → strategy name + reason

All external I/O (ADS, LLM) is injected; the kernel itself is pure Python and
has no side effects beyond calling those injected collaborators.
"""

import json

from ..ads_client.client import AdsClient
from .llm_client import MODEL_ALIAS_CEILING, LlmClient
from .manager_worker import build_manager_worker_skeleton
from .models import (
    DecomposeRequest,
    DecomposeResponse,
    ReplanRequest,
    ReplanResponse,
    SelectStrategyRequest,
    SelectStrategyResponse,
)
from .project_strategy import build_project_skeleton
from .strategies import STRATEGY_MANAGER_WORKER, STRATEGY_PLAN_THEN_EXECUTE, select_strategy
from .task_skeleton import TaskSkeleton


class PlannerValidationError(ValueError):
    pass


class PlannerExecutionError(RuntimeError):
    pass


class PlannerKernel:
    """Core planner.

    ads_client : AdsClient  -- retained for constructor compatibility only
    llm_client : LlmClient  -- LLM generation (stub or real adapter)
    """

    def __init__(self, ads_client: AdsClient, llm_client: LlmClient) -> None:
        self._ads = ads_client
        self._llm = llm_client

    # ------------------------------------------------------------------
    # Decompose
    # ------------------------------------------------------------------

    async def decompose(self, request: DecomposeRequest) -> DecomposeResponse:
        problem_spec = request.problem_spec

        if request.strategy == STRATEGY_PLAN_THEN_EXECUTE:
            # Project-mode: fixed 14-stage build pipeline, no LLM call needed
            # to decide the skeleton shape (see project_strategy.py).
            skeleton = build_project_skeleton(request.problem_spec_json)
        elif request.strategy == STRATEGY_MANAGER_WORKER:
            # Hardest decomposition the Planner does -- always CEILING tier.
            plan = await self._llm.generate_manager_worker_plan(
                tenant_id=request.tenant_id,
                run_id=request.run_id,
                objective=problem_spec.objective,
                kb_context=request.problem_spec_json,
                model_alias=MODEL_ALIAS_CEILING,
            )
            skeleton = build_manager_worker_skeleton(plan)
        else:
            skeleton = await self._llm.generate_skeleton(
                tenant_id=request.tenant_id,
                run_id=request.run_id,
                strategy=request.strategy,
                problem_spec_json=request.problem_spec_json,
            )

        # Problem Understanding owns ambiguity evidence; Planner does not
        # re-query ADS or infer ambiguity from raw conversational text.
        clarification_questions: list[str] = []
        if problem_spec.missing_information:
            clarification_questions = [f"Could you clarify: {problem_spec.missing_information[0]}"]

        return DecomposeResponse(
            task_skeleton_json=skeleton.to_json(),
            ambiguity_detected=bool(clarification_questions),
            clarification_questions=clarification_questions,
        )

    # ------------------------------------------------------------------
    # Replan
    # ------------------------------------------------------------------

    async def replan(self, request: ReplanRequest) -> ReplanResponse:
        try:
            current_skeleton = TaskSkeleton.from_json(request.current_dag_json)
        except Exception as exc:
            raise PlannerValidationError(
                f"current_dag_json is not a valid TaskSkeleton: {exc}"
            ) from exc

        try:
            json.loads(request.failure_context_json)
        except Exception as exc:
            raise PlannerValidationError(f"failure_context_json is not valid JSON: {exc}") from exc

        revised_skeleton, reason = await self._llm.revise_skeleton(
            tenant_id=request.tenant_id,
            run_id=request.run_id,
            current_skeleton=current_skeleton,
            failure_context_json=request.failure_context_json,
        )

        return ReplanResponse(
            revised_skeleton_json=revised_skeleton.to_json(),
            reason=reason,
        )

    # ------------------------------------------------------------------
    # SelectStrategy
    # ------------------------------------------------------------------

    async def select_strategy(self, request: SelectStrategyRequest) -> SelectStrategyResponse:
        strategy, reason = select_strategy(request.objective, request.mode)
        return SelectStrategyResponse(strategy=strategy, reason=reason)
