"""Verification & Quality Gate kernel: ADVANCED-tier reviewer scoring.

Implements the one operation exposed by alter.verification.v1.VerificationService:
  - score_node -- node output -> verdict/score/threshold/reviewer_model/details

Independent per-node-type grading (HEAL-2): content-bearing node types
(LLMTask, ToolCall, SandboxExec, Synthesis) are judged by an ADVANCED-tier
reviewer against a rubric tailored to that node type. Deterministic/
control-flow node types (Gate, Merge, PubSub, HumanApproval, GroupChat,
YAMLImport, MemoryWrite) get a structural completeness check instead --
an LLM judgment call on a boolean routing decision is meaningless, and
Sandbox Service already owns SandboxExec's build/render/placeholder gates
(different gate_types, EXEC-11/13) -- this kernel only adds the "quality"
gate_type on top of those.

All external I/O (the reviewer LLM) is injected; the kernel itself is pure
Python and has no side effects beyond calling that injected collaborator.
It does not persist to verification_results -- that table lives in
orchestration_db (a different service's database per the one-DB-per-service
rule); the caller (Executor/NodeexecService) owns writing this response
into that table, the same way NodeexecService owns node_executions writes.
"""

import json

from .llm_client import MODEL_ALIAS_ADVANCED, ReviewerLlmClient
from .models import NodeType, ScoreNodeRequest, ScoreNodeResponse, Verdict

DEFAULT_THRESHOLD = 0.7
# Verdict banding: score >= threshold -> pass; within this margin below
# threshold -> warn (borderline, flagged but not blocking); further below
# -> fail. A fixed margin (not a second per-node-type-tunable threshold) is
# a deliberate simplification for this ticket -- Policy Store-driven
# per-tenant threshold tuning is a later Self-Healing-phase ticket.
WARN_MARGIN = 0.15

REVIEWER_MODEL_DETERMINISTIC = "deterministic"

# Node types whose "quality" gate is a deterministic structural check, not
# an ADVANCED-reviewer judgment call: they route/merge/gate data rather
# than generate judgment-laden content.
DETERMINISTIC_NODE_TYPES: frozenset[NodeType] = frozenset(
    {
        "Gate",
        "HumanApproval",
        "Merge",
        "MemoryWrite",
        "PubSub",
        "GroupChat",
        "YAMLImport",
    }
)

# Per-node-type grading rubric for every content-bearing node type. Kept as
# plain text (not structured criteria) because the ADVANCED reviewer is an
# LLM call: the rubric is prompt content, not application logic.
NODE_TYPE_RUBRICS: dict[NodeType, str] = {
    "LLMTask": (
        "Judge whether the generated text directly and coherently addresses "
        "the task's configured goal/prompt, follows any stated instructions "
        "and constraints, and contains no unsupported or fabricated claims."
    ),
    "ToolCall": (
        "Judge whether the tool's returned result plausibly satisfies the "
        "call's intent -- not an error, empty result, or unrelated data "
        "masquerading as a successful response."
    ),
    "SandboxExec": (
        "Judge the produced code's correctness and quality relative to the "
        "task's intent: does it implement what was asked, is it free of "
        "obvious logic errors, and does it avoid placeholder/stub content. "
        "This is a semantic quality check layered on top of Sandbox "
        "Service's own deterministic build/render/placeholder gates, not a "
        "replacement for them."
    ),
    "Synthesis": (
        "Judge whether the merged output coherently incorporates every "
        "upstream result it claims to synthesize, with no unaddressed gaps "
        "or contradictions between the sources."
    ),
}


class VerificationValidationError(ValueError):
    pass


def _verdict_for(score: float, threshold: float) -> Verdict:
    if score >= threshold:
        return "pass"
    if score >= threshold - WARN_MARGIN:
        return "warn"
    return "fail"


def _is_structurally_complete(output_json: str) -> bool:
    try:
        parsed = json.loads(output_json)
    except json.JSONDecodeError:
        return False
    if parsed is None:
        return False
    if isinstance(parsed, dict) and len(parsed) == 0:
        return False
    return True


class VerificationKernel:
    """Core verification reviewer.

    llm_client : ReviewerLlmClient -- ADVANCED-tier reviewer (stub or real)
    """

    def __init__(self, llm_client: ReviewerLlmClient) -> None:
        self._llm = llm_client

    async def score_node(self, request: ScoreNodeRequest) -> ScoreNodeResponse:
        if request.node_type in DETERMINISTIC_NODE_TYPES:
            return self._score_deterministic(request)
        return await self._score_with_reviewer(request)

    def _score_deterministic(self, request: ScoreNodeRequest) -> ScoreNodeResponse:
        complete = _is_structurally_complete(request.output_json)
        score = 1.0 if complete else 0.0
        details = {
            "reason": (
                "output is a non-empty structured value"
                if complete
                else "output is empty, null, or not valid JSON"
            ),
        }
        return ScoreNodeResponse(
            verdict="pass" if complete else "fail",
            score=score,
            threshold=1.0,
            reviewer_model=REVIEWER_MODEL_DETERMINISTIC,
            details_json=json.dumps(details),
        )

    async def _score_with_reviewer(self, request: ScoreNodeRequest) -> ScoreNodeResponse:
        rubric = NODE_TYPE_RUBRICS.get(request.node_type)
        if rubric is None:
            raise VerificationValidationError(
                f"node_type {request.node_type!r} has no registered grading rubric"
            )

        score, rationale = await self._llm.review(
            tenant_id=request.tenant_id,
            run_id=request.run_id,
            node_execution_id=request.node_execution_id,
            node_type=request.node_type,
            rubric=rubric,
            config_json=request.config_json,
            output_json=request.output_json,
        )
        if not 0.0 <= score <= 1.0:
            raise VerificationValidationError(
                f"reviewer returned score {score!r} outside the [0.0, 1.0] range"
            )

        threshold = DEFAULT_THRESHOLD
        details = {"rationale": rationale, "rubric": rubric}
        return ScoreNodeResponse(
            verdict=_verdict_for(score, threshold),
            score=score,
            threshold=threshold,
            reviewer_model=MODEL_ALIAS_ADVANCED,
            details_json=json.dumps(details),
        )
