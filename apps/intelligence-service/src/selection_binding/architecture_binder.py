"""Registry- and ArchitectureSpec-driven concrete capability binding."""

from src.capability_registry.models import CapabilityRecord, CapabilitySearch
from src.capability_registry.repository import CapabilityRegistryRepository

from .models import (
    ArchitectureBindingOutcome,
    BindingBlocked,
    BindingDecision,
    BindingRequest,
    BoundCapability,
)


class ArchitectureBinder:
    def __init__(self, registry: CapabilityRegistryRepository) -> None:
        self._registry = registry

    async def bind(self, request: BindingRequest) -> ArchitectureBindingOutcome:
        bindings: list[BoundCapability] = []
        for node in sorted(request.architecture.nodes, key=lambda value: value.source_node_key):
            role = node.capability_role
            if role is None:
                continue
            candidates: list[CapabilityRecord] = []
            for kind in role.eligible_kinds:
                candidates.extend(
                    await self._registry.search(
                        request.tenant_id,
                        CapabilitySearch(
                            capabilities=role.required_capabilities,
                            kind=kind,
                            workspace_id=request.workspace_id,
                            limit=100,
                        ),
                    )
                )
            eligible = [candidate for candidate in candidates if _eligible(candidate, request)]
            if not eligible:
                return BindingBlocked(
                    source_node_key=node.source_node_key,
                    reason="Capability Registry has no active policy-eligible candidate",
                )
            selected = sorted(eligible, key=lambda candidate: _rank(candidate, request))[0]
            score, factors = _score(selected, request)
            bindings.append(
                BoundCapability(
                    record_id=selected.capability_id,
                    version=selected.version,
                    kind=selected.kind,
                    source_node_key=node.source_node_key,
                    rationale="registry capability fit with deterministic policy score",
                    score=score,
                    factors=factors,
                )
            )
        return BindingDecision(bindings=bindings)


def _eligible(candidate: CapabilityRecord, request: BindingRequest) -> bool:
    policy = request.policy
    constraints = request.architecture.constraints
    if not candidate.availability.available:
        return False
    if policy.allowed_kinds is not None and candidate.kind not in policy.allowed_kinds:
        return False
    if policy.maximum_cost_amount is not None:
        amount = candidate.availability.cost_amount
        if amount is None or amount > policy.maximum_cost_amount:
            return False
    if candidate.constraints.required_permissions and not set(
        candidate.constraints.required_permissions
    ).issubset(constraints.allowed_permissions):
        return False
    if candidate.constraints.regions and not set(candidate.constraints.regions) & set(
        constraints.allowed_regions
    ):
        return False
    if candidate.constraints.data_residency and not set(candidate.constraints.data_residency) & set(
        constraints.allowed_data_residency
    ):
        return False
    return True


def _score(candidate: CapabilityRecord, request: BindingRequest) -> tuple[float, dict[str, float]]:
    reliability = candidate.availability.reliability
    reliability_score = 0.5 if reliability is None else reliability
    latency = candidate.availability.latency_ms_p50
    latency_score = 0.5 if latency is None else 1 / (1 + latency / 1000)
    cost = candidate.availability.cost_amount
    cost_score = 0.5 if cost is None else 1 / (1 + cost)
    weights = request.policy
    total_weight = weights.reliability_weight + weights.latency_weight + weights.cost_weight
    score = (
        weights.reliability_weight * reliability_score
        + weights.latency_weight * latency_score
        + weights.cost_weight * cost_score
    ) / total_weight
    return score, {"reliability": reliability_score, "latency": latency_score, "cost": cost_score}


def _rank(candidate: CapabilityRecord, request: BindingRequest) -> tuple[float, str, int]:
    score, _ = _score(candidate, request)
    return (-score, candidate.capability_id, candidate.version)
