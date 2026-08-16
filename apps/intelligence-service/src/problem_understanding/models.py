"""Typed internal contracts for Problem Understanding.

These are intentionally intelligence-service models, not mirrors of a locked
protobuf.  A future Planner handoff needs a repo-owner-approved contract
change; see the ENGINE-05 checklist note before exposing these cross-service.
"""

import re

from pydantic import BaseModel, Field, field_validator

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


class ProblemContextReference(BaseModel):
    """Provenance for ADS context considered while understanding a problem."""

    model_config = {"frozen": True}

    document_id: str
    chunk_reference: str
    confidence: float = Field(ge=0, le=1)
    provenance_json: str


class ProblemSpec(BaseModel):
    """Defined problem handed to later intelligence stages.

    Fields match Architecture Part C.3.  Values are explicit even when not
    known: ``missing_information`` records absence instead of inventing it.
    """

    model_config = {"frozen": True}

    objective: str
    current_situation: str | None = None
    actors: list[str] = Field(default_factory=list)
    systems_involved: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    required_data: list[str] = Field(default_factory=list)
    risk: str = "unknown"
    missing_information: list[str] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)
    context_references: list[ProblemContextReference] = Field(default_factory=list)

    @field_validator("objective", "risk")
    @classmethod
    def _validate_required_text(cls, value: str, info: object) -> str:
        field = getattr(info, "field_name", "field")
        return _required(value, field)

    @field_validator(
        "actors",
        "systems_involved",
        "constraints",
        "required_data",
        "missing_information",
        "success_criteria",
    )
    @classmethod
    def _validate_text_lists(cls, value: list[str], info: object) -> list[str]:
        field = getattr(info, "field_name", "field")
        return [_required(item, f"{field}[]") for item in value]


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
