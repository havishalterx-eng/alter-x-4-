"""Pydantic mirrors of packages/contracts/proto/alter/planner/v1/planner.proto.

Field names and shapes must stay identical to the proto.  Do not add fields
that are not in the proto and do not diverge field types/nullability from it.
packages/contracts is the single source of truth for this contract; this
module only provides typed Python homes for the Planner requests/responses.
"""

import re

from pydantic import BaseModel, field_validator

from ..problem_understanding.models import ProblemSpec, parse_problem_spec_json, problem_spec_json

_UUID_V7_BODY = r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"

_TENANT_ID_RE = re.compile(rf"^ten_{_UUID_V7_BODY}$", re.IGNORECASE)
_WORKSPACE_ID_RE = re.compile(rf"^ws_{_UUID_V7_BODY}$", re.IGNORECASE)
_RUN_ID_RE = re.compile(rf"^run_{_UUID_V7_BODY}$", re.IGNORECASE)


def _validate_pattern(pattern: re.Pattern[str], value: str, field: str) -> str:
    if not pattern.match(value):
        raise ValueError(f"{field} must match {pattern.pattern}")
    return value


# ---------------------------------------------------------------------------
# Decompose
# ---------------------------------------------------------------------------


class DecomposeRequest(BaseModel):
    """HTTP Decompose request.

    ``objective`` remains in protobuf only for additive wire compatibility.
    The HTTP planner rejects it: validated ``problem_spec_json`` is the sole
    pre-planning input.
    """

    model_config = {"frozen": True, "extra": "forbid"}

    tenant_id: str
    workspace_id: str
    run_id: str
    strategy: str
    problem_spec_json: str

    @field_validator("tenant_id")
    @classmethod
    def _validate_tenant_id(cls, v: str) -> str:
        return _validate_pattern(_TENANT_ID_RE, v, "tenant_id")

    @field_validator("workspace_id")
    @classmethod
    def _validate_workspace_id(cls, v: str) -> str:
        return _validate_pattern(_WORKSPACE_ID_RE, v, "workspace_id")

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, v: str) -> str:
        return _validate_pattern(_RUN_ID_RE, v, "run_id")

    @field_validator("problem_spec_json")
    @classmethod
    def _validate_problem_spec(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("problem_spec_json must not be blank")
        try:
            return problem_spec_json(parse_problem_spec_json(v))
        except ValueError as exc:
            raise ValueError("problem_spec_json must contain a valid ProblemSpec") from exc

    @property
    def problem_spec(self) -> ProblemSpec:
        return parse_problem_spec_json(self.problem_spec_json)


class DecomposeResponse(BaseModel):
    model_config = {"frozen": True}

    task_skeleton_json: str
    ambiguity_detected: bool
    clarification_questions: list[str]


# ---------------------------------------------------------------------------
# Replan
# ---------------------------------------------------------------------------


class ReplanRequest(BaseModel):
    model_config = {"frozen": True}

    tenant_id: str
    run_id: str
    current_dag_json: str
    failure_context_json: str

    @field_validator("tenant_id")
    @classmethod
    def _validate_tenant_id(cls, v: str) -> str:
        return _validate_pattern(_TENANT_ID_RE, v, "tenant_id")

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, v: str) -> str:
        return _validate_pattern(_RUN_ID_RE, v, "run_id")

    @field_validator("current_dag_json")
    @classmethod
    def _validate_current_dag_json(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("current_dag_json must not be blank")
        return v

    @field_validator("failure_context_json")
    @classmethod
    def _validate_failure_context_json(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("failure_context_json must not be blank")
        return v


class ReplanResponse(BaseModel):
    model_config = {"frozen": True}

    revised_skeleton_json: str
    reason: str


# ---------------------------------------------------------------------------
# SelectStrategy
# ---------------------------------------------------------------------------


class SelectStrategyRequest(BaseModel):
    model_config = {"frozen": True}

    tenant_id: str
    objective: str
    mode: str

    @field_validator("tenant_id")
    @classmethod
    def _validate_tenant_id(cls, v: str) -> str:
        return _validate_pattern(_TENANT_ID_RE, v, "tenant_id")

    @field_validator("objective")
    @classmethod
    def _validate_objective(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("objective must not be blank")
        return v

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("mode must not be blank")
        return v


class SelectStrategyResponse(BaseModel):
    model_config = {"frozen": True}

    strategy: str
    reason: str
