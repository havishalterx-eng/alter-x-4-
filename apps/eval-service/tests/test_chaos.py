import pytest

from src.chaos import ChaosHarness
from src.db.chaos_scenarios import CHAOS_GOLDEN_SET
from src.db.launch_golden_sets import EvalCaseSeed
from src.hardening import MockHarness


def test_chaos_suite_has_fifteen_distinct_deterministic_scenarios() -> None:
    assert CHAOS_GOLDEN_SET.name == "chaos"
    assert len(CHAOS_GOLDEN_SET.cases) == 15
    names = {case.input_json["name"] for case in CHAOS_GOLDEN_SET.cases}
    assert len(names) == 15
    for case in CHAOS_GOLDEN_SET.cases:
        assert case.input_json["operation"] == "chaos_inject"
        assert case.scoring == {"matcher": "exact_json", "minimum_score": 1.0}
        assert "chaos" in case.tags


def test_chaos_harness_executes_every_scenario_through_the_hardening_matcher() -> None:
    chaos = ChaosHarness()
    scorer = MockHarness()

    for case in CHAOS_GOLDEN_SET.cases:
        execution = chaos.execute(case)
        assert scorer.evaluate(case, execution.output).passed is True
        assert str(case.input_json["boundary"]) in execution.diagnostic
        assert str(case.input_json["failure_mode"]) in execution.diagnostic


def test_chaos_harness_rejects_an_unregistered_failure_policy() -> None:
    unregistered = EvalCaseSeed(
        input_json={
            "operation": "chaos_inject",
            "boundary": "queue",
            "failure_mode": "corrupted",
            "attempt": 1,
        },
        expected_json={"outcome": "recovered", "strategy": "retry"},
        scoring={"matcher": "exact_json", "minimum_score": 1.0},
        tags=["chaos"],
    )

    with pytest.raises(ValueError, match="No resilience policy"):
        ChaosHarness().execute(unregistered)
