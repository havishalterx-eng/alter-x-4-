"""Strict internal ArchitectureSpec boundary; no provider bindings live here."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from src.capability_registry.models import CapabilityKind
from src.capability_resolver.models import NodeRequirements
from src.planner.task_skeleton import TaskSkeleton

_UUID_V7_BODY = r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
TenantId = Annotated[str, StringConstraints(pattern=rf"(?i)^ten_{_UUID_V7_BODY}$", strict=True)]
WorkspaceId = Annotated[str, StringConstraints(pattern=rf"(?i)^ws_{_UUID_V7_BODY}$", strict=True)]

NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]
ArchitectureTopology = Literal[
    "single", "deterministic", "sequential", "parallel", "manager_worker"
]
ArchitectureRole = Literal["direct", "manager", "worker", "deterministic", "control"]
ExecutionKind = Literal["llm", "deterministic", "control"]
BoundaryKind = Literal["verification", "human_approval"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class SynthesisConstraints(StrictModel):
    """Explicit architecture facts; UI and raw prompt data are deliberately absent."""

    coordination_required: bool = False
    verification_required: bool = False
    human_approval_required: bool = False
    customer_visible: bool = False
    allowed_regions: list[NonEmpty] = Field(default_factory=list, max_length=32)
    allowed_data_residency: list[NonEmpty] = Field(default_factory=list, max_length=32)
    allowed_permissions: list[NonEmpty] = Field(default_factory=list, max_length=64)


class SynthesizeArchitectureRequest(StrictModel):
    tenant_id: TenantId
    workspace_id: WorkspaceId
    task_skeleton: TaskSkeleton
    node_requirements: NodeRequirements
    constraints: SynthesisConstraints = Field(default_factory=SynthesisConstraints)


class EligibleCapabilityRole(StrictModel):
    source_node_key: NonEmpty
    required_capabilities: list[NonEmpty]
    eligible_kinds: list[CapabilityKind]


class ArchitectureNode(StrictModel):
    source_node_key: NonEmpty
    role: ArchitectureRole
    execution_kind: ExecutionKind
    depends_on: list[NonEmpty]
    capability_role: EligibleCapabilityRole | None = None


class ExecutionWave(StrictModel):
    order: int = Field(ge=0)
    node_keys: list[NonEmpty] = Field(min_length=1)
    depends_on_wave_orders: list[int] = Field(default_factory=list)


class ArchitectureBoundary(StrictModel):
    kind: BoundaryKind
    after_node_key: NonEmpty
    reason: NonEmpty


class ArchitectureSpec(StrictModel):
    status: Literal["ready"] = "ready"
    version: Literal["1"] = "1"
    source_task_skeleton_version: NonEmpty
    topology: ArchitectureTopology
    constraints: SynthesisConstraints
    nodes: list[ArchitectureNode] = Field(min_length=1)
    execution_waves: list[ExecutionWave] = Field(min_length=1)
    boundaries: list[ArchitectureBoundary] = Field(default_factory=list)
    rationale: list[NonEmpty] = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)


class ArchitectureBlocked(StrictModel):
    status: Literal["blocked"] = "blocked"
    code: Literal["missing_eligible_capability"] = "missing_eligible_capability"
    source_node_key: NonEmpty
    required_capabilities: list[NonEmpty] = Field(min_length=1)
    reason: NonEmpty


ArchitectureOutcome = ArchitectureSpec | ArchitectureBlocked


class ArchitectureSynthesisError(ValueError):
    pass


def validate_request_shape(request: SynthesizeArchitectureRequest) -> None:
    node_keys = [node.key for node in request.task_skeleton.nodes]
    if len(node_keys) != len(set(node_keys)):
        raise ArchitectureSynthesisError("task skeleton has duplicate node keys")
    if request.task_skeleton.entry_point not in node_keys:
        raise ArchitectureSynthesisError("task skeleton entry_point is unknown")
    if set(request.node_requirements.root) != set(node_keys):
        raise ArchitectureSynthesisError(
            "node requirements must contain exactly every task skeleton node"
        )
    for node in request.task_skeleton.nodes:
        if any(dependency not in node_keys for dependency in node.depends_on):
            raise ArchitectureSynthesisError(f"node {node.key!r} depends on unknown source node")
