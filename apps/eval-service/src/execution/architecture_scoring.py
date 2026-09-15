"""Architecture facts: what an architecture golden case is scored on.

The synthesizer's response is reduced to a small set of facts -- outcome,
blocked node, topology, waves, roles, gates -- and a case passes when every
fact its expected JSON names is equal. Facts the case does not name are not
compared, so a case about gates is not failed by an unrelated topology choice.

Gates are read from ArchitectureSpec.boundaries. A boundary with
before_node_key gates entry to that node; one with after_node_key gates the
node's output. The current contract has only after_node_key; before_node_key
is the addition the Synthesizer rewrite needs to express "verification before
an external action" (see src/db/architecture_golden_set.py).
"""

from __future__ import annotations

from typing import Any

FACT_KEYS = ("outcome", "blocked_node", "topology", "waves", "roles", "gates")


def extract_facts(response: dict[str, Any]) -> dict[str, Any]:
    status = response.get("status")
    if status == "blocked":
        return {"outcome": "blocked", "blocked_node": response.get("source_node_key")}

    gates: list[dict[str, str]] = []
    for boundary in response.get("boundaries", []):
        if boundary.get("before_node_key") is not None:
            gates.append({"kind": boundary["kind"], "before": boundary["before_node_key"]})
        if boundary.get("after_node_key") is not None:
            gates.append({"kind": boundary["kind"], "after": boundary["after_node_key"]})
    waves = sorted(response.get("execution_waves", []), key=lambda wave: wave["order"])
    return {
        "outcome": status,
        "topology": response.get("topology"),
        "waves": [sorted(wave["node_keys"]) for wave in waves],
        "roles": {node["source_node_key"]: node["role"] for node in response.get("nodes", [])},
        "gates": gates,
    }


def _gate_set(gates: list[dict[str, str]]) -> set[tuple[tuple[str, str], ...]]:
    return {tuple(sorted(gate.items())) for gate in gates}


def compare_facts(expected: dict[str, Any], observed: dict[str, Any]) -> list[str]:
    """Return one line per expected fact that the observed facts do not match."""
    mismatches: list[str] = []
    for key in FACT_KEYS:
        if key not in expected:
            continue
        want, got = expected[key], observed.get(key)
        if key == "gates":
            # A set: duplicates collapse, and an extra gate is as wrong as a
            # missing one.
            equal = isinstance(got, list) and _gate_set(want) == _gate_set(got)
        elif key == "waves":
            equal = isinstance(got, list) and [sorted(w) for w in want] == got
        else:
            equal = want == got
        if not equal:
            mismatches.append(f"{key}: expected {want!r}, observed {got!r}")
    return mismatches
