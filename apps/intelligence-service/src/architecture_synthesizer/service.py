"""Deterministic architecture policy between capability resolution and binding.

Rules, and the golden set that scores them, live in
apps/eval-service/src/db/architecture_golden_set.py. In short:

- topology, waves and roles follow the skeleton's shape and
  coordination_required;
- output leaves a run in two ways -- a tool node acts on the outside world,
  or a terminal non-tool node delivers the run's result -- and gates sit at
  exactly those two places:
    G1  verification before every tool node, always;
    G2  verification after every terminal non-tool node when verification is
        required, the output is customer-visible, or the run holds PII;
    G3  human approval before every tool node that may have side effects and
        after every terminal non-tool node when approval is required or the
        output is customer-visible. A tool node is free of side effects only
        when it names capabilities and every eligible Registry record for them
        says side_effects=false; a node naming none, or any record that is
        unlabelled or true, keeps the gate. external_action_approval_required
        asks for the before-action gates only, never the after-output ones;
- confidence is the share of executable nodes whose capability eligibility
  was confirmed against the Capability Registry.
"""

from collections.abc import Sequence
from typing import cast

from src.planner.task_skeleton import TaskNode

from .models import (
    ArchitectureBlocked,
    ArchitectureBoundary,
    ArchitectureNode,
    ArchitectureOutcome,
    ArchitectureRole,
    ArchitectureSpec,
    ArchitectureSynthesisError,
    ArchitectureTopology,
    BoundaryKind,
    EligibleCapabilityRole,
    ExecutionKind,
    ExecutionWave,
    SourceNodeType,
    SynthesisConstraints,
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
        side_effect_free: set[str] = set()
        for node in nodes:
            requirement = request.node_requirements.root[node.key]
            if not requirement.capabilities:
                continue
            eligibility = await self._registry.eligibility(
                tenant_id=request.tenant_id,
                workspace_id=request.workspace_id,
                source_node_type=node.type,
                requirement=requirement,
                constraints=request.constraints,
            )
            if not eligibility.kinds:
                return ArchitectureBlocked(
                    source_node_key=node.key,
                    required_capabilities=sorted(requirement.capabilities),
                    reason="Capability Registry has no eligible visible active record",
                )
            eligible_roles[node.key] = EligibleCapabilityRole(
                source_node_key=node.key,
                required_capabilities=sorted(requirement.capabilities),
                eligible_kinds=sorted(eligibility.kinds),
            )
            if not eligibility.side_effects:
                side_effect_free.add(node.key)

        waves = _waves(nodes)
        topology = _topology(nodes, waves, request.constraints.coordination_required)
        architecture_nodes = [
            ArchitectureNode(
                source_node_key=node.key,
                role=_role(node.key, node.type, skeleton.entry_point, topology),
                execution_kind=_execution_kind(node.type),
                # validate_request_shape rejected any other type above.
                source_node_type=cast(SourceNodeType, node.type),
                depends_on=sorted(node.depends_on),
                capability_role=eligible_roles.get(node.key),
                config=dict(node.config),
            )
            for node in nodes
        ]
        boundaries = _boundaries(nodes, request.constraints, side_effect_free)
        confidence, verified, executable = _confidence(nodes, eligible_roles)
        return ArchitectureSpec(
            source_task_skeleton_version=skeleton.version,
            topology=topology,
            constraints=request.constraints,
            nodes=architecture_nodes,
            execution_waves=waves,
            boundaries=boundaries,
            rationale=_rationale(topology, waves, boundaries, verified, executable),
            confidence=confidence,
        )


def _topology(
    nodes: Sequence[TaskNode], waves: Sequence[ExecutionWave], coordination: bool
) -> ArchitectureTopology:
    if coordination:
        return "manager_worker"
    types = {node.type for node in nodes}
    if types <= {"tool", "branch", "join"}:
        return "deterministic"
    if len(nodes) == 1:
        return "single"
    if any(len(wave.node_keys) > 1 for wave in waves):
        return "parallel"
    return "sequential"


def _waves(nodes: Sequence[TaskNode]) -> list[ExecutionWave]:
    dependencies = {node.key: set(node.depends_on) for node in nodes}
    remaining = set(dependencies)
    resolved: dict[str, int] = {}
    waves: list[ExecutionWave] = []
    while remaining:
        ready = sorted(key for key in remaining if dependencies[key].issubset(resolved))
        if not ready:
            raise ArchitectureSynthesisError("task skeleton dependency graph contains a cycle")
        order = len(waves)
        dependency_orders = sorted(
            {resolved[dependency] for key in ready for dependency in dependencies[key]}
        )
        waves.append(
            ExecutionWave(order=order, node_keys=ready, depends_on_wave_orders=dependency_orders)
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
    nodes: Sequence[TaskNode],
    constraints: SynthesisConstraints,
    side_effect_free: set[str],
) -> list[ArchitectureBoundary]:
    depended_on = {dependency for node in nodes for dependency in node.depends_on}
    actions = [node.key for node in nodes if node.type == "tool"]
    delivered = [
        node.key for node in nodes if node.type != "tool" and node.key not in depended_on
    ]

    verify_reasons = [
        reason
        for flag, reason in (
            (constraints.customer_visible, "customer-visible output"),
            (constraints.contains_pii, "output contains personal data"),
            (constraints.verification_required, "explicit verification requirement"),
        )
        if flag
    ]
    approve_reasons = [
        reason
        for flag, reason in (
            (constraints.customer_visible, "customer-visible output"),
            (constraints.human_approval_required, "explicit human approval requirement"),
        )
        if flag
    ]

    action_approve_reasons = [
        *approve_reasons,
        *(
            ["approval before external actions"]
            if constraints.external_action_approval_required
            else []
        ),
    ]

    boundaries: list[ArchitectureBoundary] = []

    def add(
        kind: BoundaryKind, reasons: Sequence[str], *, before: str = "", after: str = ""
    ) -> None:
        boundaries.append(
            ArchitectureBoundary(
                kind=kind,
                before_node_key=before or None,
                after_node_key=after or None,
                reason="; ".join(reasons),
            )
        )

    for key in actions:
        # G1: an external action is verified first, whatever the constraints.
        add("verification", ["verification precedes every external action"], before=key)
        # G3: a person approves only what can change something outside Alter.
        if action_approve_reasons and key not in side_effect_free:
            add("human_approval", action_approve_reasons, before=key)
    for key in delivered:
        if verify_reasons:
            add("verification", verify_reasons, after=key)
        if approve_reasons:
            add("human_approval", approve_reasons, after=key)
    return boundaries


def _confidence(
    nodes: Sequence[TaskNode], eligible_roles: dict[str, EligibleCapabilityRole]
) -> tuple[float, int, int]:
    """Share of executable nodes whose eligibility the Registry confirmed.

    An llm or tool node with no declared capability requirement was never
    checked, so the architecture cannot claim that something able to run it
    exists, and binding has nothing to pin for it. Control nodes run inside
    the engine and are not counted.
    """
    executable = [node.key for node in nodes if node.type in {"llm", "tool"}]
    if not executable:
        return 1.0, 0, 0
    verified = sum(1 for key in executable if key in eligible_roles)
    return round(verified / len(executable), 4), verified, len(executable)


def _rationale(
    topology: str,
    waves: Sequence[ExecutionWave],
    boundaries: Sequence[ArchitectureBoundary],
    verified: int,
    executable: int,
) -> list[str]:
    reasons = [f"topology={topology} derived from skeleton dependencies and explicit constraints"]
    if any(len(wave.node_keys) > 1 for wave in waves):
        reasons.append("independent source nodes share an execution wave")
    if any(boundary.before_node_key is not None for boundary in boundaries):
        reasons.append("external actions are gated before they run")
    if any(boundary.after_node_key is not None for boundary in boundaries):
        reasons.append("delivered output is gated by explicit safety or visibility constraints")
    if executable:
        reasons.append(
            f"capability eligibility confirmed for {verified} of {executable} executable nodes"
        )
    return reasons
