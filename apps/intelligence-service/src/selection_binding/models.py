"""Typed homes for PLAN-7 binding inputs, outputs, and no-match signals."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from src.architecture_synthesizer.models import ArchitectureSpec
from src.capability_registry.models import CapabilityKind
from src.capability_resolver.models import AgentId, ModelAlias, NodeType

_UUID_V7_BODY = (
    r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}"
)

TenantId = Annotated[
    str,
    StringConstraints(pattern=rf"(?i)^ten_{_UUID_V7_BODY}$", strict=True),
]
WorkspaceId = Annotated[
    str,
    StringConstraints(pattern=rf"(?i)^ws_{_UUID_V7_BODY}$", strict=True),
]
RunId = Annotated[
    str,
    StringConstraints(pattern=rf"(?i)^run_{_UUID_V7_BODY}$", strict=True),
]
NodeKey = Annotated[
    str,
    StringConstraints(
        pattern=r"(?i)^[a-z][a-z0-9._-]{0,127}$",
        strict=True,
    ),
]
NonEmptyString = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, strict=True),
]
Uint32 = Annotated[int, Field(strict=True, ge=0, le=4_294_967_295)]


class _StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class BindAgentModelToolRequest(_StrictFrozenModel):
    tenant_id: TenantId
    run_id: RunId
    node_key: NodeKey
    node_requirements_json: NonEmptyString


class BindAgentModelToolResponse(_StrictFrozenModel):
    agent_id: AgentId
    agent_version: Uint32
    model_alias: ModelAlias
    tool_names: list[NonEmptyString]


NoMatchReason = Literal[
    "agent_not_required",
    "preferred_agent_unavailable",
    "no_eligible_agent",
]


class NoAgentMatch(_StrictFrozenModel):
    """Normal PLAN-7 result consumed by PLAN-8; never an exception."""

    node_key: NodeKey
    reason: NoMatchReason


BindingOutcome = BindAgentModelToolResponse | NoAgentMatch


class BindingContext(_StrictFrozenModel):
    """Trusted internal context absent from the locked protobuf request."""

    workspace_id: WorkspaceId
    node_type: NodeType
    task_category: NonEmptyString | None = None


class BindingPolicy(_StrictFrozenModel):
    allowed_kinds: list[CapabilityKind] | None = None
    maximum_cost_amount: float | None = Field(default=None, ge=0)
    reliability_weight: float = Field(default=0.4, ge=0, le=1)
    latency_weight: float = Field(default=0.3, ge=0, le=1)
    cost_weight: float = Field(default=0.3, ge=0, le=1)

    @model_validator(mode="after")
    def has_scoring_weight(self) -> "BindingPolicy":
        if self.reliability_weight + self.latency_weight + self.cost_weight <= 0:
            raise ValueError("at least one binding score weight must be positive")
        return self


class BindingRequest(_StrictFrozenModel):
    tenant_id: TenantId
    workspace_id: WorkspaceId
    architecture: ArchitectureSpec
    policy: BindingPolicy = Field(default_factory=BindingPolicy)


class BoundCapability(_StrictFrozenModel):
    record_id: NonEmptyString
    version: int = Field(gt=0)
    kind: CapabilityKind
    source_node_key: NodeKey
    rationale: NonEmptyString
    score: float = Field(ge=0, le=1)
    factors: dict[NonEmptyString, float] = Field(min_length=1)


class BindingDecision(_StrictFrozenModel):
    status: Literal["ready"] = "ready"
    bindings: list[BoundCapability]


class BindingBlocked(_StrictFrozenModel):
    status: Literal["blocked"] = "blocked"
    source_node_key: NodeKey
    reason: NonEmptyString


ArchitectureBindingOutcome = BindingDecision | BindingBlocked
