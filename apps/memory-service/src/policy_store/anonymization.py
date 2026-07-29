from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping

_RUN_VERDICTS = frozenset(
    {"completed_verified", "rescued", "escalated", "failed", "abandoned", "degraded"}
)
_FAILURE_CLASSES = frozenset(
    {
        "infrastructure_failure",
        "logic_output_failure",
        "timeout",
        "tool_permission_denial",
        "sandbox_crash",
        "rate_limit",
        "safety_violation",
        "unknown",
    }
)
_RECOVERY_STRATEGIES = frozenset(
    {
        "repair",
        "retry",
        "backoff",
        "swap_agent",
        "escalate_model",
        "recompile",
        "replan",
        "degrade",
        "ask_user",
        "terminate",
    }
)
_NODE_TYPES = frozenset(
    {
        "LLMTask",
        "ToolCall",
        "SandboxExec",
        "Gate",
        "HumanApproval",
        "Merge",
        "Synthesis",
        "MemoryWrite",
        "PubSub",
        "GroupChat",
        "YAMLImport",
    }
)


def anonymize_global_content(content: Mapping[str, object]) -> dict[str, object]:
    """Reduce tenant learning to aggregate/categorical, content-free signals."""

    result: dict[str, object] = {
        "schema": "global_memory_v1",
        "anonymized": True,
        "irreversible": True,
    }
    final_verdict = _allowed_category(content.get("final_verdict"), _RUN_VERDICTS)
    if final_verdict is not None:
        result["final_verdict"] = final_verdict

    gates = content.get("gates")
    if isinstance(gates, Mapping):
        safe_gates = {
            key: value
            for key in ("passed", "failed")
            if isinstance((value := gates.get(key)), int) and value >= 0
        }
        if safe_gates:
            result["gates"] = safe_gates

    recovery_count = content.get("recovery_count")
    if isinstance(recovery_count, int) and recovery_count >= 0:
        result["recovery_count"] = recovery_count

    recovery_actions = content.get("recovery_actions")
    if isinstance(recovery_actions, list):
        result.update(_recovery_summary(recovery_actions))

    nodes = content.get("nodes")
    if isinstance(nodes, list):
        node_types = Counter(
            category
            for item in nodes
            if isinstance(item, Mapping)
            if (category := _allowed_category(item.get("node_type"), _NODE_TYPES)) is not None
        )
        if node_types:
            result["node_type_counts"] = dict(sorted(node_types.items()))
    return result


def anonymized_global_provenance(evaluation_run_id: str) -> dict[str, object]:
    return {
        "promotion": {
            "evaluation_run_id": evaluation_run_id,
            "anonymized": True,
            "irreversible": True,
            "source_identifiers_removed": True,
        }
    }


def _recovery_summary(actions: Iterable[object]) -> dict[str, object]:
    failure_classes: set[str] = set()
    strategies: set[str] = set()
    for action in actions:
        if not isinstance(action, Mapping):
            continue
        failure_class = _allowed_category(action.get("failure_class"), _FAILURE_CLASSES)
        strategy = _allowed_category(action.get("strategy"), _RECOVERY_STRATEGIES)
        if failure_class is not None:
            failure_classes.add(failure_class)
        if strategy is not None:
            strategies.add(strategy)
    result: dict[str, object] = {}
    if failure_classes:
        result["failure_classes"] = sorted(failure_classes)
    if strategies:
        result["strategies"] = sorted(strategies)
    return result


def _allowed_category(value: object, allowed: frozenset[str]) -> str | None:
    return value if isinstance(value, str) and value in allowed else None
