"""Typed adapter over Capability Registry facts; never returns provider bindings."""

from collections.abc import Sequence
from typing import Protocol

from src.capability_registry.models import CapabilityKind, CapabilityRecord, CapabilitySearch
from src.capability_registry.repository import CapabilityRegistryRepository
from src.capability_resolver.models import NodeRequirement

from .models import SynthesisConstraints


class CapabilityRegistryClient(Protocol):
    async def eligible_kinds(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        source_node_type: str,
        requirement: NodeRequirement,
        constraints: SynthesisConstraints,
    ) -> list[CapabilityKind]: ...


class RepositoryCapabilityRegistryClient:
    """Production adapter retaining Registry tenant/workspace search semantics."""

    def __init__(self, repository: CapabilityRegistryRepository) -> None:
        self._repository = repository

    async def eligible_kinds(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        source_node_type: str,
        requirement: NodeRequirement,
        constraints: SynthesisConstraints,
    ) -> list[CapabilityKind]:
        kinds = _candidate_kinds(source_node_type)
        found: list[CapabilityKind] = []
        for kind in kinds:
            records = await self._repository.search(
                tenant_id,
                CapabilitySearch(
                    capabilities=requirement.capabilities,
                    kind=kind,
                    workspace_id=workspace_id,
                    limit=100,
                ),
            )
            if any(_eligible(record, requirement, constraints) for record in records):
                found.append(kind)
        return found


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
    if not _within(record.constraints.regions, constraints.allowed_regions):
        return False
    return _within(record.constraints.data_residency, constraints.allowed_data_residency)


def _within(candidate_values: Sequence[str], allowed_values: Sequence[str]) -> bool:
    return not candidate_values or bool(set(candidate_values) & set(allowed_values))
