"""Problem-understanding request validation plus generated planner contracts."""

import re
from typing import TYPE_CHECKING, Any, TypeAlias, cast

from google.protobuf.json_format import MessageToJson, Parse, ParseError
from pydantic import BaseModel, Field, field_validator

from alter.planner.v1 import planner_pb2

if TYPE_CHECKING:
    ProblemContextReference: TypeAlias = Any  # noqa: UP040
    ProblemSpec: TypeAlias = Any  # noqa: UP040
else:
    ProblemContextReference = planner_pb2.ProblemContextReference
    ProblemSpec = planner_pb2.ProblemSpec

_UUID_V7_BODY = r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
_TENANT_ID_RE = re.compile(rf"^ten_{_UUID_V7_BODY}$", re.IGNORECASE)
_WORKSPACE_ID_RE = re.compile(rf"^ws_{_UUID_V7_BODY}$", re.IGNORECASE)
_RUN_ID_RE = re.compile(rf"^run_{_UUID_V7_BODY}$", re.IGNORECASE)


def _required(value: str, field: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field} must not be blank")
    return normalized


def _validate_id(pattern: re.Pattern[str], value: str, field: str) -> str:
    if not pattern.fullmatch(value):
        raise ValueError(f"{field} must be a prefixed UUIDv7")
    return value


def validate_problem_spec(spec: ProblemSpec) -> ProblemSpec:
    """Enforce business invariants around the protobuf-generated contract."""
    _required(spec.objective, "objective")
    if not spec.HasField("risk"):
        spec.risk = "unknown"
    _required(spec.risk, "risk")
    for field in (
        "actors",
        "systems_involved",
        "constraints",
        "required_data",
        "missing_information",
        "success_criteria",
    ):
        for item in getattr(spec, field):
            _required(item, f"{field}[]")
    for reference in spec.context_references:
        if not 0 <= reference.confidence <= 1:
            raise ValueError("context_references[].confidence must be from 0 to 1")
    return spec


def parse_problem_spec_json(value: str) -> ProblemSpec:
    spec = ProblemSpec()
    try:
        Parse(value, spec, ignore_unknown_fields=False)
    except (ParseError, TypeError, ValueError) as exc:
        raise ValueError("problem_spec_json must contain a valid ProblemSpec") from exc
    return validate_problem_spec(spec)


def problem_spec_json(spec: ProblemSpec) -> str:
    validate_problem_spec(spec)
    return cast(str, MessageToJson(spec, preserving_proto_field_name=True))


def apply_authoritative_problem_fields(
    spec: ProblemSpec,
    objective: str,
    references: list[ProblemContextReference],
) -> ProblemSpec:
    result = ProblemSpec()
    result.CopyFrom(spec)
    result.objective = objective
    del result.context_references[:]
    result.context_references.extend(references)
    return validate_problem_spec(result)


class ProblemUnderstandingRequest(BaseModel):
    """Raw, tenant-scoped input before planning begins."""

    model_config = {"frozen": True}

    tenant_id: str
    workspace_id: str
    run_id: str
    objective: str
    actor_context: dict[str, str] = Field(default_factory=dict)

    @field_validator("tenant_id")
    @classmethod
    def _validate_tenant(cls, value: str) -> str:
        return _validate_id(_TENANT_ID_RE, value, "tenant_id")

    @field_validator("workspace_id")
    @classmethod
    def _validate_workspace(cls, value: str) -> str:
        return _validate_id(_WORKSPACE_ID_RE, value, "workspace_id")

    @field_validator("run_id")
    @classmethod
    def _validate_run(cls, value: str) -> str:
        return _validate_id(_RUN_ID_RE, value, "run_id")

    @field_validator("objective")
    @classmethod
    def _validate_objective(cls, value: str) -> str:
        return _required(value, "objective")

    @field_validator("actor_context")
    @classmethod
    def _validate_actor_context(cls, value: dict[str, str]) -> dict[str, str]:
        return {
            _required(key, "actor_context key"): _required(item, "actor_context value")
            for key, item in value.items()
        }
