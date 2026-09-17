"""Catalog checks for architecture golden set v1.

These check that the hand-written expectations are internally consistent
with the rules in src/db/architecture_golden_set.py -- not that any
synthesizer meets them. They would catch a typo'd node key or a case that
quietly contradicts G1, which the eval run would otherwise report as a
synthesizer failure.
"""

from typing import Any

from src.db.architecture_golden_set import (
    ARCHITECTURE_CASES,
    ARCHITECTURE_CASES_V2,
    ARCHITECTURE_GOLDEN_SET,
    ARCHITECTURE_GOLDEN_SET_V2,
    ARCHITECTURE_REGISTRY_FIXTURE,
)
from src.db.launch_golden_sets import LAUNCH_GOLDEN_SETS, case_id


def _cases() -> list[Any]:
    # Typed as Any: seeds hold dict[str, object], and these checks index deep into them.
    # v2 contains every v1 case, so checking v2 checks both.
    return list(ARCHITECTURE_CASES_V2)


def _by_tag() -> dict[str, Any]:
    return {case.tags[-1]: case for case in _cases()}


def _nodes(case: Any) -> dict[str, dict[str, Any]]:
    return {node["key"]: node for node in case.input_json["task_skeleton"]["nodes"]}


def _gate_tuple(gate: dict[str, str]) -> tuple[str, str, str]:
    position = "before" if "before" in gate else "after"
    return gate["kind"], position, gate[position]


def test_catalog_shape_and_ids() -> None:
    v1, v2 = ARCHITECTURE_GOLDEN_SET, ARCHITECTURE_GOLDEN_SET_V2
    assert (v1.name, v1.domain, v1.version) == ("architecture", "architecture", 1)
    assert (v2.name, v2.domain, v2.version) == ("architecture", "architecture", 2)
    # v1 is frozen as migration 0010 seeded it; v2 appends and never reorders.
    assert len(ARCHITECTURE_CASES) == 24
    assert len(ARCHITECTURE_CASES_V2) == 28
    assert ARCHITECTURE_CASES_V2[:24] == ARCHITECTURE_CASES
    assert len(_by_tag()) == 28

    v1_ids = {case_id(v1, position) for position in range(1, 25)}
    v2_ids = {case_id(v2, position) for position in range(1, 29)}
    assert len(v1_ids) == 24
    assert len(v2_ids) == 28
    other_ids = {
        case_id(seed, position)
        for seed in LAUNCH_GOLDEN_SETS
        for position in range(1, len(seed.cases) + 1)
    }
    assert not v1_ids & v2_ids
    assert not (v1_ids | v2_ids) & other_ids

    groups = {case.tags[2] for case in _cases()}
    assert groups == {"shape", "external", "gates", "pii", "residency", "effects"}
    for case in _cases():
        assert case.input_json["operation"] == "synthesize"
        assert case.scoring["matcher"] == "architecture_facts"
        assert case.tags[:2] == ["launch-floor", "architecture"]


def _side_effect_free(capabilities: list[str]) -> bool:
    # G3's condition. The fixture sets no availability or residency limits on
    # these records, so every record supporting the capabilities is eligible.
    if not capabilities:
        return False
    candidates = [
        record
        for record in ARCHITECTURE_REGISTRY_FIXTURE
        if set(capabilities) <= set(record["supported_capabilities"])
    ]
    return bool(candidates) and all(record.get("side_effects") is False for record in candidates)


def test_expected_gates_follow_the_gate_rules() -> None:
    for case in _cases():
        expected = case.expected_json
        if expected["outcome"] != "ready" or "gates" not in expected:
            continue
        nodes = _nodes(case)
        constraints = case.input_json["constraints"]
        depended_on = {dep for node in nodes.values() for dep in node["depends_on"]}
        tools = {key for key, node in nodes.items() if node["type"] == "tool"}
        terminal_outputs = {key for key in nodes if key not in depended_on and key not in tools}
        requirements = case.input_json["node_requirements"]
        acting_tools = {
            key for key in tools if not _side_effect_free(requirements[key]["capabilities"])
        }

        want: set[tuple[str, str, str]] = {("verification", "before", key) for key in tools}
        if (
            constraints.get("verification_required")
            or constraints.get("customer_visible")
            or constraints.get("contains_pii")
        ):
            want |= {("verification", "after", key) for key in terminal_outputs}
        if constraints.get("human_approval_required") or constraints.get("customer_visible"):
            want |= {("human_approval", "before", key) for key in acting_tools}
            want |= {("human_approval", "after", key) for key in terminal_outputs}

        written = {_gate_tuple(gate) for gate in expected["gates"]}
        assert written == want, case.tags[-1]
        assert len(written) == len(expected["gates"]), f"duplicate gate in {case.tags[-1]}"


def test_expected_facts_name_only_real_nodes() -> None:
    for case in _cases():
        nodes = set(_nodes(case))
        expected = case.expected_json
        assert set(expected) <= {"outcome", "blocked_node", "topology", "waves", "roles", "gates"}
        if "waves" in expected:
            assert sorted(key for wave in expected["waves"] for key in wave) == sorted(nodes)
        if "roles" in expected:
            assert set(expected["roles"]) == nodes
        if expected["outcome"] == "blocked":
            assert expected["blocked_node"] in nodes
        assert set(case.input_json["node_requirements"]) == nodes


def test_paired_cases_differ_only_by_constraints() -> None:
    cases = _by_tag()
    for bare, constrained in (
        ("shape-parallel", "gates-all-constraints"),
        ("pii-absent-no-gate", "pii-delivered-output"),
    ):
        bare_case, constrained_case = cases[bare], cases[constrained]
        assert (
            bare_case.input_json["task_skeleton"] == constrained_case.input_json["task_skeleton"]
        )
        assert bare_case.input_json["constraints"] != constrained_case.input_json["constraints"]
        assert bare_case.expected_json["gates"] != constrained_case.expected_json["gates"]


def test_residency_cases_use_only_fixture_capabilities() -> None:
    fixture = {
        capability
        for record in ARCHITECTURE_REGISTRY_FIXTURE
        for capability in record["supported_capabilities"]
    }
    for case in _cases():
        required = {
            capability
            for requirement in case.input_json["node_requirements"].values()
            for capability in requirement["capabilities"]
        }
        if case.tags[2] in {"residency", "effects"}:
            assert required and required <= fixture, case.tags[-1]
        else:
            assert not required, case.tags[-1]
