from collections.abc import Sequence

import pytest

from src.architecture_synthesizer.models import (
    ArchitectureBlocked,
    ArchitectureSpec,
    SynthesisConstraints,
    SynthesizeArchitectureRequest,
)
from src.architecture_synthesizer.registry_client import _eligible
from src.architecture_synthesizer.service import ArchitectureSynthesizer
from src.capability_registry.models import CapabilityKind, CapabilityRecord
from src.capability_resolver.models import NodeRequirement, NodeRequirements
from src.planner.task_skeleton import TaskNode, TaskSkeleton

TENANT = "ten_aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa"
WORKSPACE = "ws_bbbbbbbb-0000-7000-8000-bbbbbbbbbbbb"


class Registry:
    def __init__(self, unavailable: Sequence[str] = ()) -> None:
        self._unavailable = set(unavailable)

    async def eligible_kinds(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        source_node_type: str,
        requirement: NodeRequirement,
        constraints: SynthesisConstraints,
    ) -> list[CapabilityKind]:
        del tenant_id, workspace_id, constraints
        if set(requirement.capabilities) & self._unavailable:
            return []
        return ["tool"] if source_node_type == "tool" else ["model"]


def request(
    nodes: list[TaskNode], constraints: SynthesisConstraints | None = None
) -> SynthesizeArchitectureRequest:
    requirements = {
        node.key: NodeRequirement(
            capabilities=["code.execution"] if node.type == "tool" else ["text.generation"]
        )
        for node in nodes
    }
    return SynthesizeArchitectureRequest(
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
        task_skeleton=TaskSkeleton(nodes=nodes, entry_point=nodes[0].key),
        node_requirements=NodeRequirements(root=requirements),
        constraints=constraints or SynthesisConstraints(),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("nodes", "constraints", "topology"),
    [
        ([TaskNode(key="one", type="llm")], None, "single"),
        ([TaskNode(key="one", type="tool")], None, "deterministic"),
        (
            [TaskNode(key="one", type="llm"), TaskNode(key="two", type="llm", depends_on=["one"])],
            None,
            "sequential",
        ),
        (
            [TaskNode(key="one", type="llm"), TaskNode(key="two", type="llm")],
            None,
            "parallel",
        ),
        (
            [TaskNode(key="one", type="llm"), TaskNode(key="two", type="llm", depends_on=["one"])],
            SynthesisConstraints(coordination_required=True),
            "manager_worker",
        ),
    ],
)
async def test_selects_topology_from_explicit_skeleton_facts(
    nodes: list[TaskNode], constraints: SynthesisConstraints | None, topology: str
) -> None:
    result = await ArchitectureSynthesizer(Registry()).synthesize(request(nodes, constraints))
    assert isinstance(result, ArchitectureSpec)
    assert result.topology == topology
    assert result.constraints == constraints or result.constraints == SynthesisConstraints()
    assert [node.source_node_key for node in result.nodes] == sorted(node.key for node in nodes)
    assert all("id" not in role.model_dump() for role in result.nodes if role.capability_role)


@pytest.mark.asyncio
async def test_blocks_when_registry_has_no_eligible_capability() -> None:
    result = await ArchitectureSynthesizer(Registry(["text.generation"])).synthesize(
        request([TaskNode(key="one", type="llm")])
    )
    assert isinstance(result, ArchitectureBlocked)
    assert result.source_node_key == "one"
    assert result.required_capabilities == ["text.generation"]


@pytest.mark.asyncio
async def test_adds_explicit_verification_and_approval_boundaries() -> None:
    result = await ArchitectureSynthesizer(Registry()).synthesize(
        request(
            [TaskNode(key="one", type="llm")],
            SynthesisConstraints(customer_visible=True),
        )
    )
    assert isinstance(result, ArchitectureSpec)
    assert [(boundary.kind, boundary.after_node_key) for boundary in result.boundaries] == [
        ("verification", "one"),
        ("human_approval", "one"),
    ]


@pytest.mark.asyncio
async def test_output_is_stable_and_preserves_dependencies() -> None:
    value = request(
        [
            TaskNode(key="zeta", type="llm", depends_on=["alpha"]),
            TaskNode(key="alpha", type="llm"),
        ]
    )
    synthesizer = ArchitectureSynthesizer(Registry())
    first = await synthesizer.synthesize(value)
    second = await synthesizer.synthesize(value)
    assert first == second
    assert isinstance(first, ArchitectureSpec)
    assert first.nodes[1].source_node_key == "zeta"
    assert first.nodes[1].depends_on == ["alpha"]


def test_registry_eligibility_filters_availability_capacity_and_constraints() -> None:
    record = CapabilityRecord.model_validate(
        {
            "capability_id": "model",
            "version": 1,
            "owner_tenant_id": "aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa",
            "kind": "model",
            "scope": "tenant",
            "supported_capabilities": ["text.generation"],
            "constraints": {"regions": ["us"], "maximum_input_bytes": 10},
            "availability": {"available": False},
            "provenance": {"source": "test"},
            "status": "active",
        }
    )
    requirement = NodeRequirement(capabilities=["text.generation"], maximum_input_bytes=11)
    assert not _eligible(record, requirement, SynthesisConstraints(allowed_regions=["us"]))
    available = CapabilityRecord.model_validate(
        record.model_dump() | {"availability": {"available": True}}
    )
    assert not _eligible(available, requirement, SynthesisConstraints(allowed_regions=["us"]))
    smaller = requirement.model_copy(update={"maximum_input_bytes": 10})
    assert not _eligible(available, smaller, SynthesisConstraints(allowed_regions=["eu"]))
    assert _eligible(available, smaller, SynthesisConstraints(allowed_regions=["us"]))
