"""Pydantic mirrors for WorkflowDAG node requirements.

``packages/contracts/src/workflow-dag.ts`` is the source of truth.  These
models intentionally preserve its field names, optionality, enum literals,
strict-object behavior, and identifier constraints.
"""

from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    StringConstraints,
    model_validator,
)

ModelAlias = Literal["FAST", "STANDARD", "ADVANCED", "CEILING"]
NodeType = Literal[
    "LLMTask",
    "ToolCall",
    "SandboxExec",
    "Gate",
    "HumanApproval",
    "Merge",
    "Synthesis",
    "MemoryWrite",
    "PubSub",
    "GroupChat",
    "YAMLImport",
]

NonEmptyString = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, strict=True),
]
NodeKey = Annotated[
    str,
    StringConstraints(
        pattern=r"(?i)^[a-z][a-z0-9._-]{0,127}$",
        strict=True,
    ),
]
AgentId = Annotated[
    str,
    StringConstraints(
        pattern=(
            r"(?i)^agt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-"
            r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
        ),
        strict=True,
    ),
]
PositiveInteger = Annotated[int, Field(strict=True, gt=0)]


class _StrictContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ToolRequirement(_StrictContractModel):
    name: NonEmptyString
    version: NonEmptyString | None = None
    permissions: list[NonEmptyString]

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_null_version(cls, data: object) -> object:
        if isinstance(data, dict) and "version" in data and data["version"] is None:
            raise ValueError("version may be omitted but cannot be null")
        return data


class NodeRequirement(_StrictContractModel):
    capabilities: list[NonEmptyString]
    model_alias: ModelAlias | None = None
    tools: list[ToolRequirement] | None = None
    preferred_agent_id: AgentId | None = None
    maximum_input_bytes: PositiveInteger | None = None

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_null_optional_fields(cls, data: object) -> object:
        if isinstance(data, dict):
            for field_name in (
                "model_alias",
                "tools",
                "preferred_agent_id",
                "maximum_input_bytes",
            ):
                if field_name in data and data[field_name] is None:
                    raise ValueError(f"{field_name} may be omitted but cannot be null")
        return data


class NodeRequirements(RootModel[dict[NodeKey, NodeRequirement]]):
    """Root mapping equivalent to the TypeScript ``NodeRequirementsSchema``."""

    model_config = ConfigDict(frozen=True, strict=True)


class WorkflowDagNodeMetadata(BaseModel):
    """Only validates metadata's required envelope; resolver never reads ``ui``."""

    model_config = ConfigDict(extra="allow", frozen=True, strict=True)

    ui: dict[str, Any]


class WorkflowDagNode(_StrictContractModel):
    """Input mirror for the node subset consumed by the resolver."""

    key: NodeKey
    type: NodeType
    config: dict[str, Any]
    metadata: WorkflowDagNodeMetadata
