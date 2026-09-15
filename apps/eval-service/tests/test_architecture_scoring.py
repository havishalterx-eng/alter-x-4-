from src.execution.architecture_scoring import compare_facts, extract_facts

_SPEC = {
    "status": "ready",
    "topology": "sequential",
    "nodes": [
        {"source_node_key": "draft", "role": "direct"},
        {"source_node_key": "send", "role": "deterministic"},
    ],
    "execution_waves": [
        {"order": 1, "node_keys": ["send"]},
        {"order": 0, "node_keys": ["draft"]},
    ],
    "boundaries": [
        {"kind": "verification", "before_node_key": "send", "reason": "external action"},
        {"kind": "human_approval", "after_node_key": "draft", "reason": "approval"},
    ],
}


def test_extract_facts_orders_waves_and_reads_both_gate_positions() -> None:
    facts = extract_facts(_SPEC)

    assert facts == {
        "outcome": "ready",
        "topology": "sequential",
        "waves": [["draft"], ["send"]],
        "roles": {"draft": "direct", "send": "deterministic"},
        "gates": [
            {"kind": "verification", "before": "send"},
            {"kind": "human_approval", "after": "draft"},
        ],
    }


def test_extract_facts_for_blocked_outcome() -> None:
    blocked = {"status": "blocked", "source_node_key": "send", "required_capabilities": ["x"]}

    assert extract_facts(blocked) == {"outcome": "blocked", "blocked_node": "send"}


def test_compare_only_checks_facts_the_case_names() -> None:
    observed = extract_facts(_SPEC)

    assert compare_facts({"outcome": "ready"}, observed) == []
    assert compare_facts({"topology": "parallel"}, observed) == [
        "topology: expected 'parallel', observed 'sequential'"
    ]


def test_gates_compare_as_a_set() -> None:
    observed = extract_facts(_SPEC)
    same_in_other_order = [
        {"kind": "human_approval", "after": "draft"},
        {"kind": "verification", "before": "send"},
    ]

    assert compare_facts({"gates": same_in_other_order}, observed) == []
    # A missing gate and an extra gate both fail.
    assert compare_facts({"gates": same_in_other_order[:1]}, observed)
    assert compare_facts(
        {"gates": [*same_in_other_order, {"kind": "verification", "after": "send"}]}, observed
    )


def test_before_gate_is_not_satisfied_by_an_after_gate() -> None:
    # The current contract can only put a gate after a node. Placing it after
    # the node that feeds an action is not the same as gating the action.
    after_only = {**_SPEC, "boundaries": [{"kind": "verification", "after_node_key": "send"}]}

    assert compare_facts(
        {"gates": [{"kind": "verification", "before": "send"}]}, extract_facts(after_only)
    )


def test_waves_compare_ignoring_order_within_a_wave() -> None:
    spec = {**_SPEC, "execution_waves": [{"order": 0, "node_keys": ["b", "a"]}]}

    assert compare_facts({"waves": [["a", "b"]]}, extract_facts(spec)) == []
