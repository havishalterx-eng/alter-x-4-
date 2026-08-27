"""Pure-function tests for anonymize_global_content and
anonymized_global_provenance -- no Postgres/HTTP stack needed (unlike the
_integration-suffixed tests in this directory). These two functions are the
data-minimization boundary between tenant-specific run data and the shared,
cross-tenant "global memory" store: repository.py's promote_memory replaces
a record's content entirely with anonymize_global_content's output and sets
tenant_id to None when scope == "global" -- irreversible. The core
discipline under test is that every field either passes an explicit
allowlist check or is silently dropped; there is no default-permissive
path anywhere in this module.
"""

from __future__ import annotations

from src.policy_store.anonymization import (
    anonymize_global_content,
    anonymized_global_provenance,
)


def test_empty_content_produces_only_the_always_present_keys() -> None:
    result = anonymize_global_content({})

    assert result == {
        "schema": "global_memory_v1",
        "anonymized": True,
        "irreversible": True,
    }


def test_final_verdict_passes_through_when_allowlisted() -> None:
    result = anonymize_global_content({"final_verdict": "completed_verified"})

    assert result["final_verdict"] == "completed_verified"


def test_final_verdict_is_silently_dropped_when_not_allowlisted() -> None:
    # The highest-value case from the original audit finding: an
    # unrecognized/injected verdict must be absent from the result
    # entirely, not set to None and not passed through raw.
    result = anonymize_global_content({"final_verdict": "totally_made_up_verdict"})

    assert "final_verdict" not in result


def test_final_verdict_is_silently_dropped_when_not_a_string() -> None:
    result = anonymize_global_content({"final_verdict": 42})

    assert "final_verdict" not in result


def test_gates_keeps_only_passed_and_failed_and_drops_unrelated_keys() -> None:
    result = anonymize_global_content({"gates": {"passed": 3, "failed": 1, "skipped": 5}})

    assert result["gates"] == {"passed": 3, "failed": 1}


def test_gates_drops_a_negative_value() -> None:
    result = anonymize_global_content({"gates": {"passed": -1, "failed": 2}})

    assert result["gates"] == {"failed": 2}


def test_gates_drops_non_int_values() -> None:
    result = anonymize_global_content({"gates": {"passed": "3", "failed": 1.5}})

    assert "gates" not in result


def test_gates_absent_when_not_a_mapping() -> None:
    result = anonymize_global_content({"gates": ["passed", "failed"]})

    assert "gates" not in result


def test_gates_absent_when_missing() -> None:
    result = anonymize_global_content({})

    assert "gates" not in result


def test_recovery_count_passes_through_when_non_negative() -> None:
    result = anonymize_global_content({"recovery_count": 4})

    assert result["recovery_count"] == 4


def test_recovery_count_absent_when_negative() -> None:
    result = anonymize_global_content({"recovery_count": -1})

    assert "recovery_count" not in result


def test_recovery_count_absent_when_not_an_int() -> None:
    result = anonymize_global_content({"recovery_count": "4"})

    assert "recovery_count" not in result


def test_recovery_count_absent_when_missing() -> None:
    result = anonymize_global_content({})

    assert "recovery_count" not in result


def test_recovery_actions_dedupe_and_sort_failure_classes_and_strategies() -> None:
    result = anonymize_global_content(
        {
            "recovery_actions": [
                {"failure_class": "timeout", "strategy": "retry"},
                {"failure_class": "timeout", "strategy": "backoff"},
                {"failure_class": "rate_limit", "strategy": "retry"},
            ]
        }
    )

    assert result["failure_classes"] == ["rate_limit", "timeout"]
    assert result["strategies"] == ["backoff", "retry"]


def test_unrecognized_failure_class_and_strategy_are_dropped() -> None:
    result = anonymize_global_content(
        {"recovery_actions": [{"failure_class": "made_up", "strategy": "made_up"}]}
    )

    assert "failure_classes" not in result
    assert "strategies" not in result


def test_malformed_recovery_action_is_skipped_without_crashing() -> None:
    result = anonymize_global_content(
        {"recovery_actions": ["not-a-mapping", {"failure_class": "timeout"}]}
    )

    assert result["failure_classes"] == ["timeout"]
    assert "strategies" not in result


def test_recovery_action_with_neither_field_contributes_nothing() -> None:
    result = anonymize_global_content({"recovery_actions": [{"other": "field"}]})

    assert "failure_classes" not in result
    assert "strategies" not in result


def test_recovery_actions_absent_when_not_a_list() -> None:
    result = anonymize_global_content({"recovery_actions": "not-a-list"})

    assert "failure_classes" not in result
    assert "strategies" not in result


def test_node_type_counts_counts_repeats_and_sorts_by_key() -> None:
    result = anonymize_global_content(
        {
            "nodes": [
                {"node_type": "ToolCall"},
                {"node_type": "LLMTask"},
                {"node_type": "ToolCall"},
                {"node_type": "ToolCall"},
            ]
        }
    )

    assert result["node_type_counts"] == {"LLMTask": 1, "ToolCall": 3}
    assert list(result["node_type_counts"]) == ["LLMTask", "ToolCall"]


def test_unrecognized_node_types_are_excluded_entirely_not_counted_as_other() -> None:
    result = anonymize_global_content({"nodes": [{"node_type": "MadeUpNode"}]})

    assert "node_type_counts" not in result


def test_malformed_node_item_is_skipped_without_crashing() -> None:
    result = anonymize_global_content({"nodes": ["not-a-mapping", {"node_type": "Gate"}]})

    assert result["node_type_counts"] == {"Gate": 1}


def test_node_type_counts_absent_when_nodes_empty_or_all_invalid() -> None:
    assert "node_type_counts" not in anonymize_global_content({"nodes": []})
    assert "node_type_counts" not in anonymize_global_content({"nodes": ["bad", 123]})


def test_a_full_realistic_run_produces_the_complete_expected_shape_and_drops_raw_content() -> None:
    content = {
        "final_verdict": "rescued",
        "gates": {"passed": 5, "failed": 1, "irrelevant": "x"},
        "recovery_count": 2,
        "recovery_actions": [
            {"failure_class": "timeout", "strategy": "retry"},
            {"failure_class": "rate_limit", "strategy": "backoff"},
        ],
        "nodes": [
            {"node_type": "LLMTask"},
            {"node_type": "ToolCall"},
            {"node_type": "ToolCall"},
        ],
        # Not part of any allowlist -- must never leak into global memory.
        "raw_transcript": "sensitive user content",
        "tenant_secret": "shh",
    }

    result = anonymize_global_content(content)

    assert result == {
        "schema": "global_memory_v1",
        "anonymized": True,
        "irreversible": True,
        "final_verdict": "rescued",
        "gates": {"passed": 5, "failed": 1},
        "recovery_count": 2,
        "failure_classes": ["rate_limit", "timeout"],
        "strategies": ["backoff", "retry"],
        "node_type_counts": {"LLMTask": 1, "ToolCall": 2},
    }


def test_anonymized_global_provenance_returns_the_exact_shape() -> None:
    result = anonymized_global_provenance("run_123")

    assert result == {
        "promotion": {
            "evaluation_run_id": "run_123",
            "anonymized": True,
            "irreversible": True,
            "source_identifiers_removed": True,
        }
    }
