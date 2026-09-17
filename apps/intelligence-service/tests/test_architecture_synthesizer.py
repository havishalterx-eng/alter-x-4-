from collections.abc import Sequence

import pytest
from pydantic import ValidationError

from src.architecture_synthesizer.models import (
    ArchitectureBlocked,
    ArchitectureBoundary,
    ArchitectureSpec,
    ArchitectureSynthesisError,
    SynthesisConstraints,
    SynthesizeArchitectureRequest,
)
from src.architecture_synthesizer.registry_client import (
    CapabilityEligibility,
    RepositoryCapabilityRegistryClient,
    _eligible,
)
from src.architecture_synthesizer.service import ArchitectureSynthesizer
from src.capability_registry.models import CapabilityRecord, CapabilitySearch
from src.capability_resolver.models import NodeRequirement, NodeRequirements
from src.planner.task_skeleton import TaskNode, TaskSkeleton

TENANT = "ten_aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa"
WORKSPACE = "ws_bbbbbbbb-0000-7000-8000-bbbbbbbbbbbb"


class Registry:
    def __init__(
        self, unavailable: Sequence[str] = (), side_effect_free: Sequence[str] = ()
    ) -> None:
        self._unavailable = set(unavailable)
        self._side_effect_free = set(side_effect_free)

    async def eligibility(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        source_node_type: str,
        requirement: NodeRequirement,
        constraints: SynthesisConstraints,
    ) -> CapabilityEligibility:
        del tenant_id, workspace_id, constraints
        capabilities = set(requirement.capabilities)
        if capabilities & self._unavailable:
            return CapabilityEligibility(kinds=[], side_effects=True)
        return CapabilityEligibility(
            kinds=["tool"] if source_node_type == "tool" else ["model"],
            side_effects=not capabilities <= self._side_effect_free,
        )


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
async def test_constraints_shape_gates_while_topology_follows_the_skeleton() -> None:
    """Replaces the Batch 5 probe that pinned identical output under wildly
    different stakes (rebuild plan, "Synthesizer identical-output-under-
    different-constraints").

    Constraints now decide where verification and approval sit, including
    PII, which the contract could not express before. Topology, waves and
    roles still follow the skeleton's shape and coordination_required -- a
    deliberate product rule of architecture golden set v1, not an oversight.
    """
    nodes = [
        TaskNode(key="draft", type="llm"),
        TaskNode(key="send", type="tool", depends_on=["draft"]),
        TaskNode(key="log", type="llm", depends_on=["send"]),
    ]
    low = await ArchitectureSynthesizer(Registry()).synthesize(request(nodes))
    high = await ArchitectureSynthesizer(Registry()).synthesize(
        request(
            nodes,
            SynthesisConstraints(
                human_approval_required=True,
                contains_pii=True,
                allowed_data_residency=["eu"],
            ),
        )
    )

    assert isinstance(low, ArchitectureSpec)
    assert isinstance(high, ArchitectureSpec)
    assert low.topology == high.topology == "sequential"
    assert _gates(low) == [("verification", "before", "send")]
    assert _gates(high) == [
        ("verification", "before", "send"),
        ("human_approval", "before", "send"),
        ("verification", "after", "log"),
        ("human_approval", "after", "log"),
    ]


def _gates(spec: ArchitectureSpec) -> list[tuple[str, str, str]]:
    return [
        (b.kind, "before", b.before_node_key)
        if b.before_node_key is not None
        else (b.kind, "after", str(b.after_node_key))
        for b in spec.boundaries
    ]


@pytest.mark.asyncio
async def test_every_external_action_is_verified_before_it_runs_without_any_constraint() -> None:
    result = await ArchitectureSynthesizer(Registry()).synthesize(
        request(
            [
                TaskNode(key="prepare", type="llm"),
                TaskNode(key="post_a", type="tool", depends_on=["prepare"]),
                TaskNode(key="post_b", type="tool", depends_on=["prepare"]),
            ]
        )
    )

    assert isinstance(result, ArchitectureSpec)
    assert _gates(result) == [
        ("verification", "before", "post_a"),
        ("verification", "before", "post_b"),
    ]
    assert all(b.reason == "verification precedes every external action" for b in result.boundaries)


@pytest.mark.asyncio
async def test_customer_visible_action_is_approved_before_it_and_nothing_gates_after() -> None:
    result = await ArchitectureSynthesizer(Registry()).synthesize(
        request(
            [
                TaskNode(key="write", type="llm"),
                TaskNode(key="send", type="tool", depends_on=["write"]),
            ],
            SynthesisConstraints(customer_visible=True),
        )
    )

    assert isinstance(result, ArchitectureSpec)
    assert _gates(result) == [
        ("verification", "before", "send"),
        ("human_approval", "before", "send"),
    ]


@pytest.mark.asyncio
async def test_approval_skips_side_effect_free_actions_but_verification_does_not() -> None:
    nodes = [
        TaskNode(key="lookup", type="tool"),
        TaskNode(key="send", type="tool", depends_on=["lookup"]),
    ]
    value = request(nodes, SynthesisConstraints(human_approval_required=True))
    requirements = NodeRequirements(
        root={
            "lookup": NodeRequirement(capabilities=["crm.read"]),
            "send": NodeRequirement(capabilities=["email.send"]),
        }
    )
    value = value.model_copy(update={"node_requirements": requirements})

    result = await ArchitectureSynthesizer(Registry(side_effect_free=["crm.read"])).synthesize(
        value
    )

    assert isinstance(result, ArchitectureSpec)
    assert _gates(result) == [
        ("verification", "before", "lookup"),
        ("verification", "before", "send"),
        ("human_approval", "before", "send"),
    ]


@pytest.mark.asyncio
async def test_external_action_approval_gates_side_effect_actions_and_never_output() -> None:
    nodes = [
        TaskNode(key="lookup", type="tool"),
        TaskNode(key="send", type="tool", depends_on=["lookup"]),
        TaskNode(key="summary", type="llm", depends_on=["send"]),
    ]
    value = request(nodes, SynthesisConstraints(external_action_approval_required=True))
    requirements = NodeRequirements(
        root={
            "lookup": NodeRequirement(capabilities=["crm.read"]),
            "send": NodeRequirement(capabilities=["email.send"]),
            "summary": NodeRequirement(capabilities=["text.generation"]),
        }
    )
    value = value.model_copy(update={"node_requirements": requirements})

    result = await ArchitectureSynthesizer(Registry(side_effect_free=["crm.read"])).synthesize(
        value
    )

    assert isinstance(result, ArchitectureSpec)
    # Unlike human_approval_required, nothing is approved after "summary".
    assert _gates(result) == [
        ("verification", "before", "lookup"),
        ("verification", "before", "send"),
        ("human_approval", "before", "send"),
    ]
    approval = next(b for b in result.boundaries if b.kind == "human_approval")
    assert approval.reason == "approval before external actions"


@pytest.mark.asyncio
async def test_a_tool_naming_no_capability_is_still_approved() -> None:
    value = request(
        [TaskNode(key="lookup", type="tool")], SynthesisConstraints(customer_visible=True)
    )
    unchecked = NodeRequirements(root={"lookup": NodeRequirement(capabilities=[])})
    value = value.model_copy(update={"node_requirements": unchecked})
    registry = Registry(side_effect_free=["code.execution"])

    result = await ArchitectureSynthesizer(registry).synthesize(value)

    assert isinstance(result, ArchitectureSpec)
    assert ("human_approval", "before", "lookup") in _gates(result)


class SearchOnly:
    def __init__(self, records: list[CapabilityRecord]) -> None:
        self.records = records

    async def search(self, tenant_id: str, query: CapabilitySearch) -> list[CapabilityRecord]:
        del tenant_id
        return [record for record in self.records if record.kind == query.kind]


def _tool_record(identifier: str, **fields: object) -> CapabilityRecord:
    return CapabilityRecord.model_validate(
        {
            "capability_id": identifier,
            "version": 1,
            "owner_tenant_id": "aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa",
            "kind": "tool",
            "scope": "tenant",
            "supported_capabilities": ["crm.read"],
            "provenance": {"source": "test"},
            "status": "active",
        }
        | fields
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("records", "side_effects"),
    [
        ([_tool_record("a", side_effects=False), _tool_record("b", side_effects=False)], False),
        # Binding may choose either record, so one that acts is enough.
        ([_tool_record("a", side_effects=False), _tool_record("b", side_effects=True)], True),
        # Unlabelled means it acts.
        ([_tool_record("a")], True),
        # An ineligible record cannot be bound, so it does not count.
        (
            [
                _tool_record("a", side_effects=False),
                _tool_record("b", availability={"available": False}),
            ],
            False,
        ),
    ],
)
async def test_registry_eligibility_reports_side_effects_across_every_eligible_record(
    records: list[CapabilityRecord], side_effects: bool
) -> None:
    client = RepositoryCapabilityRegistryClient(SearchOnly(records))  # type: ignore[arg-type]
    result = await client.eligibility(
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
        source_node_type="tool",
        requirement=NodeRequirement(capabilities=["crm.read"]),
        constraints=SynthesisConstraints(),
    )
    assert result == CapabilityEligibility(kinds=["tool"], side_effects=side_effects)


@pytest.mark.asyncio
async def test_pii_verifies_delivered_output_and_reasons_combine() -> None:
    result = await ArchitectureSynthesizer(Registry()).synthesize(
        request(
            [TaskNode(key="summarize", type="llm")],
            SynthesisConstraints(contains_pii=True, customer_visible=True),
        )
    )

    assert isinstance(result, ArchitectureSpec)
    assert _gates(result) == [
        ("verification", "after", "summarize"),
        ("human_approval", "after", "summarize"),
    ]
    assert result.boundaries[0].reason == "customer-visible output; output contains personal data"


def test_boundary_needs_exactly_one_placement() -> None:
    with pytest.raises(ValidationError, match="exactly one"):
        ArchitectureBoundary(kind="verification", reason="x")
    with pytest.raises(ValidationError, match="exactly one"):
        ArchitectureBoundary(
            kind="verification", before_node_key="a", after_node_key="a", reason="x"
        )


@pytest.mark.asyncio
async def test_confidence_is_the_share_of_executable_nodes_the_registry_confirmed() -> None:
    nodes = [
        TaskNode(key="draft", type="llm"),
        TaskNode(key="send", type="tool", depends_on=["draft"]),
        TaskNode(key="merge", type="join", depends_on=["send"]),
    ]
    value = request(nodes)
    # The resolver declares no capability for tool nodes, so nothing checks
    # that the tool exists; the join runs inside the engine and is not counted.
    unchecked = value.model_copy(
        update={
            "node_requirements": NodeRequirements(
                root={
                    "draft": NodeRequirement(capabilities=["text.generation"]),
                    "send": NodeRequirement(capabilities=[]),
                    "merge": NodeRequirement(capabilities=[]),
                }
            )
        }
    )

    all_checked = await ArchitectureSynthesizer(Registry()).synthesize(value)
    half_checked = await ArchitectureSynthesizer(Registry()).synthesize(unchecked)

    assert isinstance(all_checked, ArchitectureSpec)
    assert isinstance(half_checked, ArchitectureSpec)
    assert all_checked.confidence == 1.0
    assert half_checked.confidence == 0.5
    assert "capability eligibility confirmed for 1 of 2 executable nodes" in half_checked.rationale


def test_residency_restricted_record_is_eligible_when_the_tenant_sets_no_residency() -> None:
    record = CapabilityRecord.model_validate(
        {
            "capability_id": "model",
            "version": 1,
            "owner_tenant_id": "aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa",
            "kind": "model",
            "scope": "tenant",
            "supported_capabilities": ["text.generation"],
            "constraints": {"data_residency": ["eu"], "regions": ["eu-west-1"]},
            "provenance": {"source": "test"},
            "status": "active",
        }
    )
    requirement = NodeRequirement(capabilities=["text.generation"])

    assert _eligible(record, requirement, SynthesisConstraints())
    assert _eligible(record, requirement, SynthesisConstraints(allowed_data_residency=["eu"]))
    assert not _eligible(record, requirement, SynthesisConstraints(allowed_data_residency=["us"]))
    assert not _eligible(record, requirement, SynthesisConstraints(allowed_regions=["us-east-1"]))


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


@pytest.mark.asyncio
async def test_carries_the_skeleton_node_type_so_branch_and_join_stay_distinct() -> None:
    result = await ArchitectureSynthesizer(Registry()).synthesize(
        request(
            [
                TaskNode(key="classify", type="llm"),
                TaskNode(key="route", type="branch", depends_on=["classify"]),
                TaskNode(key="answer", type="llm", depends_on=["route"]),
                TaskNode(key="collect", type="join", depends_on=["answer"]),
            ]
        )
    )

    assert isinstance(result, ArchitectureSpec)
    by_key = {node.source_node_key: node for node in result.nodes}
    # Both are execution_kind "control"; only source_node_type tells them apart.
    assert (by_key["route"].execution_kind, by_key["route"].source_node_type) == (
        "control",
        "branch",
    )
    assert (by_key["collect"].execution_kind, by_key["collect"].source_node_type) == (
        "control",
        "join",
    )


@pytest.mark.asyncio
async def test_rejects_an_unknown_skeleton_node_type() -> None:
    with pytest.raises(ArchitectureSynthesisError, match="unknown type 'loop'"):
        await ArchitectureSynthesizer(Registry()).synthesize(
            request([TaskNode(key="spin", type="loop")])
        )
