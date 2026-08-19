import pytest

from src.chaos import ChaosHarness
from src.db.launch_golden_sets import EvalCaseSeed

REAL_CASES: tuple[tuple[str, int, str, str], ...] = (
    ("credential_missing", 1, "escalated", "repair"),
    ("safety_violation", 1, "escalated", "ask_user"),
    ("tool_permission_denial", 1, "escalated", "ask_user"),
    ("rate_limit", 1, "resolved", "backoff"),
    ("timeout", 1, "resolved", "retry"),
    ("timeout", 2, "escalated", "swap_agent"),
    ("infrastructure_failure", 1, "resolved", "retry"),
    ("infrastructure_failure", 2, "escalated", "swap_agent"),
    ("sandbox_crash", 1, "resolved", "retry"),
    ("sandbox_crash", 2, "resolved", "recompile"),
    ("logic_output_failure", 1, "resolved", "escalate_model"),
    ("logic_output_failure", 2, "resolved", "replan"),
    ("agent_creation_failure", 1, "escalated", "swap_agent"),
    ("agent_creation_failure", 2, "escalated", "ask_user"),
    ("unknown", 1, "escalated", "ask_user"),
)


def _case(failure_class: str, node_attempt: int) -> EvalCaseSeed:
    return EvalCaseSeed(
        input_json={
            "operation": "chaos_inject",
            "failure_class": failure_class,
            "node_attempt": node_attempt,
        },
        expected_json={},
        scoring={"matcher": "exact_json", "minimum_score": 1.0},
        tags=["chaos"],
    )


def test_chaos_harness_covers_every_locked_failure_class_with_real_outcomes() -> None:
    chaos = ChaosHarness()

    assert {failure_class for failure_class, _, _, _ in REAL_CASES} == {
        "infrastructure_failure",
        "logic_output_failure",
        "timeout",
        "tool_permission_denial",
        "sandbox_crash",
        "rate_limit",
        "safety_violation",
        "credential_missing",
        "agent_creation_failure",
        "unknown",
    }

    for failure_class, node_attempt, outcome, strategy in REAL_CASES:
        execution = chaos.execute(_case(failure_class, node_attempt))
        assert execution.output == {"outcome": outcome, "strategy": strategy}
        assert execution.diagnostic == (
            f"{failure_class}:node_attempt={node_attempt}:{strategy}"
        )

    assert {outcome for _, _, outcome, _ in REAL_CASES} <= {
        "resolved",
        "failed",
        "escalated",
    }


def test_chaos_harness_matches_timeout_repeat_dispatch_pairing() -> None:
    # Sources: recovery-strategy-table.ts:195-198; recovery-dispatch.service.ts:167,305-363.
    execution = ChaosHarness().execute(_case("timeout", 2))

    assert execution.output == {"outcome": "escalated", "strategy": "swap_agent"}


def test_chaos_harness_matches_logic_repeat_dispatch_pairing() -> None:
    # Sources: recovery-strategy-table.ts:202-203; recovery-dispatch.service.ts:142-149,367-395.
    execution = ChaosHarness().execute(_case("logic_output_failure", 2))

    assert execution.output == {"outcome": "resolved", "strategy": "replan"}


def test_chaos_harness_rejects_an_unregistered_failure_policy() -> None:
    unregistered = EvalCaseSeed(
        input_json={
            "operation": "chaos_inject",
            "failure_class": "timeout",
            "node_attempt": 3,
        },
        expected_json={"outcome": "resolved", "strategy": "retry"},
        scoring={"matcher": "exact_json", "minimum_score": 1.0},
        tags=["chaos"],
    )

    with pytest.raises(ValueError, match="No resilience policy"):
        ChaosHarness().execute(unregistered)
