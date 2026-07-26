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
from ..ads_client.models import RetrievalHit, RetrieveRequest
from .llm_client import LlmClient
from .models import (
    DecomposeRequest,
    DecomposeResponse,
    ReplanRequest,
    ReplanResponse,
    SelectStrategyRequest,
    SelectStrategyResponse,
)
from .strategies import select_strategy
from .task_skeleton import TaskSkeleton

_ADS_KB_TOP_K = 5


class PlannerValidationError(ValueError):
    pass


class PlannerExecutionError(RuntimeError):
    pass


class PlannerKernel:
    """Core planner.

    ads_client : AdsClient  -- knowledge-base retrieval (stub or real)
    llm_client : LlmClient  -- LLM generation (stub or real adapter)
    """

    def __init__(self, ads_client: AdsClient, llm_client: LlmClient) -> None:
        self._ads = ads_client
        self._llm = llm_client

    # ------------------------------------------------------------------
    # Decompose
    # ------------------------------------------------------------------

    async def decompose(self, request: DecomposeRequest) -> DecomposeResponse:
        # Fetch KB context for the objective.
        retrieve_resp = await self._ads.retrieve(
            RetrieveRequest(
                tenant_id=request.tenant_id,
                workspace_id=request.workspace_id,
                query=request.objective,
                top_k=_ADS_KB_TOP_K,
            )
        )
        kb_context = _hits_to_context(retrieve_resp.hits)

        skeleton = await self._llm.generate_skeleton(
            tenant_id=request.tenant_id,
            run_id=request.run_id,
            objective=request.objective,
            strategy=request.strategy,
            kb_context=kb_context,
        )

        # Ambiguity: non-trivial objective with zero KB hits raises a question.
        clarification_questions: list[str] = []
        if not retrieve_resp.hits and len(request.objective.split()) > 10:
            clarification_questions = [
                "Could you clarify the scope and expected output of this objective?"
            ]

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
            raise PlannerValidationError(
                f"failure_context_json is not valid JSON: {exc}"
            ) from exc

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

    async def select_strategy(
        self, request: SelectStrategyRequest
    ) -> SelectStrategyResponse:
        strategy, reason = select_strategy(request.objective, request.mode)
        return SelectStrategyResponse(strategy=strategy, reason=reason)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hits_to_context(hits: list[RetrievalHit]) -> str:
    """Serialise ADS retrieval hits to a plain string for the LLM prompt."""
    if not hits:
        return ""
    try:
        return json.dumps([h.model_dump() for h in hits])
    except Exception:
        return ""
