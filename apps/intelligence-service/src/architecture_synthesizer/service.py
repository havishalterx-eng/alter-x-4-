"""Deterministic topology policy between capability resolution and binding."""

from collections.abc import Sequence

from .models import (
    ArchitectureBlocked,
    ArchitectureBoundary,
    ArchitectureNode,
    ArchitectureOutcome,
    ArchitectureRole,
    ArchitectureSpec,
    ArchitectureTopology,
    EligibleCapabilityRole,
    ExecutionKind,
    ExecutionWave,
    SynthesizeArchitectureRequest,
    validate_request_shape,
)
from .registry_client import CapabilityRegistryClient


class ArchitectureSynthesizer:
    def __init__(self, registry: CapabilityRegistryClient) -> None:
        self._registry = registry

    async def synthesize(self, request: SynthesizeArchitectureRequest) -> ArchitectureOutcome:
        validate_request_shape(request)
        skeleton = request.task_skeleton
        nodes = sorted(skeleton.nodes, key=lambda node: node.key)
        eligible_roles: dict[str, EligibleCapabilityRole] = {}
        for node in nodes:
            requirement = request.node_requirements.root[node.key]
            if not requirement.capabilities:
                continue
            kinds = await self._registry.eligible_kinds(
                tenant_id=request.tenant_id,
                workspace_id=request.workspace_id,
                source_node_type=node.type,
                requirement=requirement,
                constraints=request.constraints,
            )
            if not kinds:
                return ArchitectureBlocked(
                    source_node_key=node.key,
                    required_capabilities=sorted(requirement.capabilities),
                    reason="Capability Registry has no eligible visible active record",
                )
            eligible_roles[node.key] = EligibleCapabilityRole(
                source_node_key=node.key,
                required_capabilities=sorted(requirement.capabilities),
                eligible_kinds=sorted(kinds),
            )

        waves = _waves(nodes)
        topology = _topology(nodes, waves, request.constraints.coordination_required)
        architecture_nodes = [
            ArchitectureNode(
                source_node_key=node.key,
                role=_role(node.key, node.type, skeleton.entry_point, topology),
                execution_kind=_execution_kind(node.type),
                depends_on=sorted(node.depends_on),
                capability_role=eligible_roles.get(node.key),
            )
            for node in nodes
        ]
        boundaries = _boundaries(nodes, request)
        rationale = _rationale(topology, waves, boundaries)
        return ArchitectureSpec(
            source_task_skeleton_version=skeleton.version,
            topology=topology,
            constraints=request.constraints,
            nodes=architecture_nodes,
            execution_waves=waves,
            boundaries=boundaries,
            rationale=rationale,
            confidence=1.0,
        )


def _topology(
    nodes: Sequence[object], waves: Sequence[ExecutionWave], coordination: bool
) -> ArchitectureTopology:
    if coordination:
        return "manager_worker"
    types = {getattr(node, "type") for node in nodes}
    if types <= {"tool", "branch", "join"}:
        return "deterministic"
    if len(nodes) == 1:
        return "single"
    if any(len(wave.node_keys) > 1 for wave in waves):
        return "parallel"
    return "sequential"


def _waves(nodes: Sequence[object]) -> list[ExecutionWave]:
    dependencies = {getattr(node, "key"): set(getattr(node, "depends_on")) for node in nodes}
    remaining = set(dependencies)
    resolved: dict[str, int] = {}
    waves: list[ExecutionWave] = []
    while remaining:
        ready = sorted(
            key for key in remaining if dependencies[key].issubset(resolved)
        )
        if not ready:
            from .models import ArchitectureSynthesisError

            raise ArchitectureSynthesisError("task skeleton dependency graph contains a cycle")
        order = len(waves)
        dependency_orders = sorted(
            {resolved[dependency] for key in ready for dependency in dependencies[key]}
        )
        waves.append(
            ExecutionWave(
                order=order,
                node_keys=ready,
                depends_on_wave_orders=dependency_orders,
            )
        )
        resolved.update(dict.fromkeys(ready, order))
        remaining.difference_update(ready)
    return waves


def _role(
    node_key: str, node_type: str, entry_point: str, topology: ArchitectureTopology
) -> ArchitectureRole:
    if topology == "manager_worker":
        if node_key == entry_point:
            return "manager"
        if node_type == "llm":
            return "worker"
    if node_type == "tool":
        return "deterministic"
    if node_type in {"branch", "join"}:
        return "control"
    return "direct"


def _execution_kind(node_type: str) -> ExecutionKind:
    if node_type == "llm":
        return "llm"
    if node_type == "tool":
        return "deterministic"
    return "control"


def _boundaries(
    nodes: Sequence[object], request: SynthesizeArchitectureRequest
) -> list[ArchitectureBoundary]:
    if not (
        request.constraints.verification_required
        or request.constraints.human_approval_required
        or request.constraints.customer_visible
    ):
        return []
    depended_on = {dependency for node in nodes for dependency in getattr(node, "depends_on")}
    terminal_nodes = sorted(
        getattr(node, "key") for node in nodes if getattr(node, "key") not in depended_on
    )
    boundaries: list[ArchitectureBoundary] = []
    if request.constraints.verification_required or request.constraints.customer_visible:
        reason = (
            "customer-visible output"
            if request.constraints.customer_visible
            else "explicit verification requirement"
        )
        boundaries.extend(
            ArchitectureBoundary(kind="verification", after_node_key=key, reason=reason)
            for key in terminal_nodes
        )
    if request.constraints.human_approval_required or request.constraints.customer_visible:
        reason = (
            "customer-visible output"
            if request.constraints.customer_visible
            else "explicit human approval requirement"
        )
        boundaries.extend(
            ArchitectureBoundary(kind="human_approval", after_node_key=key, reason=reason)
            for key in terminal_nodes
        )
    return boundaries


def _rationale(
    topology: str, waves: Sequence[ExecutionWave], boundaries: Sequence[ArchitectureBoundary]
) -> list[str]:
    reasons = [f"topology={topology} derived from skeleton dependencies and explicit constraints"]
    if any(len(wave.node_keys) > 1 for wave in waves):
        reasons.append("independent source nodes share an execution wave")
    if boundaries:
        reasons.append("boundaries derived from explicit safety or visibility constraints")
    return reasons
