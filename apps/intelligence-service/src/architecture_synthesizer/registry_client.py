"""Typed adapter over Capability Registry facts; never returns provider bindings."""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from src.capability_registry.models import CapabilityKind, CapabilityRecord, CapabilitySearch
from src.capability_registry.repository import CapabilityRegistryRepository
from src.capability_resolver.models import NodeRequirement

from .models import SynthesisConstraints


@dataclass(frozen=True)
class CapabilityEligibility:
    """What the Registry can offer one node: the kinds that fit, and whether
    any record that fits acts on the outside world."""

    kinds: list[CapabilityKind]
    # True when any eligible record has side effects. Binding may pick any of
    # them, so a node is only side-effect free when every candidate is.
    side_effects: bool


class CapabilityRegistryClient(Protocol):
    async def eligibility(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        source_node_type: str,
        requirement: NodeRequirement,
        constraints: SynthesisConstraints,
    ) -> CapabilityEligibility: ...


class RepositoryCapabilityRegistryClient:
    """Production adapter retaining Registry tenant/workspace search semantics."""

    def __init__(self, repository: CapabilityRegistryRepository) -> None:
        self._repository = repository

    async def eligibility(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        source_node_type: str,
        requirement: NodeRequirement,
        constraints: SynthesisConstraints,
    ) -> CapabilityEligibility:
        found: list[CapabilityKind] = []
        side_effects = False
        for kind in _candidate_kinds(source_node_type):
            records = await self._repository.search(
                tenant_id,
                CapabilitySearch(
                    capabilities=requirement.capabilities,
                    kind=kind,
                    workspace_id=workspace_id,
                    limit=100,
                ),
            )
            eligible = [record for record in records if _eligible(record, requirement, constraints)]
            if eligible:
                found.append(kind)
                side_effects = side_effects or any(record.side_effects for record in eligible)
        return CapabilityEligibility(kinds=found, side_effects=side_effects)


def _candidate_kinds(source_node_type: str) -> tuple[CapabilityKind, ...]:
    if source_node_type == "llm":
        return ("agent", "model")
    if source_node_type == "tool":
        return ("tool", "connector", "execution")
    return ()


def _eligible(
    record: CapabilityRecord,
    requirement: NodeRequirement,
    constraints: SynthesisConstraints,
) -> bool:
    if not record.availability.available:
        return False
    if requirement.maximum_input_bytes is not None:
        maximum = record.constraints.maximum_input_bytes
        if maximum is None or maximum < requirement.maximum_input_bytes:
            return False
    required_permissions = set(record.constraints.required_permissions)
    declared_permissions = set(constraints.allowed_permissions)
    declared_permissions.update(
        permission for tool in requirement.tools or [] for permission in tool.permissions
    )
    if not required_permissions.issubset(declared_permissions):
        return False
    if not within_allowed(record.constraints.regions, constraints.allowed_regions):
        return False
    return within_allowed(record.constraints.data_residency, constraints.allowed_data_residency)


def within_allowed(candidate_values: Sequence[str], allowed_values: Sequence[str]) -> bool:
    """Region and residency fit, shared by synthesis and binding so they cannot disagree."""
    # An unrestricted record fits any constraint, and a restricted record fits a
    # tenant that sets none. Only two non-empty lists have to intersect.
    if not candidate_values or not allowed_values:
        return True
    return bool(set(candidate_values) & set(allowed_values))
