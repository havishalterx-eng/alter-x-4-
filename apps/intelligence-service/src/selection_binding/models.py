"""Typed homes for PLAN-7 binding inputs, outputs, and no-match signals.

The request/response field names mirror
``packages/contracts/proto/alter/binding/v1/binding.proto``.  Workspace and
performance context stay in a separate internal model because those fields do
not exist on the locked protobuf request.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

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
