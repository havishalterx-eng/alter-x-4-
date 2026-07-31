from uuid import uuid4

from src.db.launch_golden_sets import LAUNCH_GOLDEN_SETS
from src.db.redteam_suites import REDTEAM_GOLDEN_SETS
from src.db.remaining_golden_sets import REMAINING_GOLDEN_SETS
from src.hardening import (
    InMemoryRegressionCaseStore,
    MockHarness,
    PersistedEvalCase,
    RegressionCapturePipeline,
    passing_mock_output,
)


def test_mock_harness_exercises_every_launch_category_without_a_model() -> None:
    harness = MockHarness()
    all_sets = (*LAUNCH_GOLDEN_SETS, *REMAINING_GOLDEN_SETS)

    assert {golden_set.name for golden_set in all_sets} == {
        "planner",
        "intent",
        "retrieval",
        "verification",
        "recovery",
        "injection",
        "tenant-isolation",
        "workflow E2E",
        "project E2E",
    }
    for golden_set in all_sets:
        evaluation = harness.evaluate(golden_set.cases[0], passing_mock_output(golden_set.cases[0]))
        assert evaluation.passed is True
        assert evaluation.failure_reason is None


def test_failing_mock_case_is_captured_once_as_a_reusable_regression_case() -> None:
    source = PersistedEvalCase(
        id=uuid4(),
        golden_set_id=uuid4(),
        input_json={"operation": "select_strategy", "objective": "Fix a typo"},
        expected_json={"strategy": "direct"},
        scoring={"matcher": "exact_json", "minimum_score": 1.0},
        tags=["launch-floor", "planner"],
    )
    store = InMemoryRegressionCaseStore((source,))
    pipeline = RegressionCapturePipeline(store)
    failed = MockHarness().evaluate(LAUNCH_GOLDEN_SETS[0].cases[0], {"strategy": "manager_worker"})

    first = pipeline.capture(source.id, failed)
    second = pipeline.capture(source.id, failed)

    assert first is not None and first.created is True
    assert second is not None and second.created is False
    captured = store.get(first.regression_case_id)
    assert captured is not None
    assert captured.golden_set_id == source.golden_set_id
    assert captured.input_json == source.input_json
    assert captured.expected_json == source.expected_json
    regression = captured.scoring["regression"]
    assert isinstance(regression, dict)
    assert regression["source_case_id"] == str(source.id)
    assert "regression" in captured.tags


def test_passing_mock_case_never_creates_a_regression_case() -> None:
    source = PersistedEvalCase(
        id=uuid4(),
        golden_set_id=uuid4(),
        input_json={},
        expected_json={"outcome": "blocked"},
        scoring={"matcher": "exact_json"},
        tags=["injection"],
    )
    pipeline = RegressionCapturePipeline(InMemoryRegressionCaseStore((source,)))

    result = pipeline.capture(
        source.id, MockHarness().evaluate(REMAINING_GOLDEN_SETS[1].cases[0], {"outcome": "blocked"})
    )

    assert result is None


def test_redteam_suites_load_and_execute_without_a_live_model() -> None:
    harness = MockHarness()

    assert {golden_set.name: len(golden_set.cases) for golden_set in REDTEAM_GOLDEN_SETS} == {
        "redteam-prompt-injection": 6,
        "redteam-jailbreak": 6,
        "redteam-ssrf": 6,
    }
    for golden_set in REDTEAM_GOLDEN_SETS:
        for case in golden_set.cases:
            assert case.scoring == {"matcher": "exact_json", "minimum_score": 1.0}
            assert case.expected_json["outcome"] == "blocked"
            assert "redteam" in case.tags
            assert harness.evaluate(case, passing_mock_output(case)).passed is True


def test_redteam_failure_is_captured_as_a_reusable_regression_case() -> None:
    golden_set = REDTEAM_GOLDEN_SETS[2]
    source = PersistedEvalCase(
        id=uuid4(),
        golden_set_id=golden_set.id,
        input_json=dict(golden_set.cases[0].input_json),
        expected_json=dict(golden_set.cases[0].expected_json),
        scoring=dict(golden_set.cases[0].scoring),
        tags=list(golden_set.cases[0].tags),
    )
    pipeline = RegressionCapturePipeline(InMemoryRegressionCaseStore((source,)))

    captured = pipeline.capture(source.id, MockHarness().evaluate(golden_set.cases[0], {}))

    assert captured is not None and captured.created is True
