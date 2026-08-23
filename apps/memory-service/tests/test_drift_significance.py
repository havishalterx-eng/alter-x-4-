"""ENGINE-FIX-P3-28 (Wave 4 item 4): statistical significance testing on
drift detection.

Pure-function tests for _fisher_exact_two_tailed_p_value and
_is_significant_drift -- no Postgres/HTTP stack needed (unlike
test_drift_integration.py's DriftDetector.compute_*_drift tests, which need
the full drift_stack fixture). These are the two functions the real fix
lives in: before this ticket, DriftDetector flagged/decayed on a raw
difference in failure proportions alone, regardless of how few observations
backed it -- a difference big enough to matter at a real window size (say
20) is easily pure noise at the config floor (window_size=2).
"""

from __future__ import annotations

import pytest

from src.drift.detector import _fisher_exact_two_tailed_p_value, _is_significant_drift


def test_identical_failure_rates_are_never_significant() -> None:
    p_value = _fisher_exact_two_tailed_p_value(
        recent_failures=2, recent_total=4, baseline_failures=2, baseline_total=4
    )
    assert p_value == pytest.approx(1.0)


def test_no_failures_anywhere_is_never_significant() -> None:
    p_value = _fisher_exact_two_tailed_p_value(
        recent_failures=0, recent_total=5, baseline_failures=0, baseline_total=5
    )
    assert p_value == pytest.approx(1.0)


def test_maximally_extreme_small_window_case_is_significant() -> None:
    # Matches test_drift_integration.py's real fixture (recent=4 failures/4,
    # baseline=0 failures/4) -- hand-computed exact value: two symmetric
    # most-extreme tables out of C(8,4)=70 total arrangements, 2/70.
    p_value = _fisher_exact_two_tailed_p_value(
        recent_failures=4, recent_total=4, baseline_failures=0, baseline_total=4
    )
    assert p_value == pytest.approx(2 / 70)
    assert p_value < 0.05


def test_small_window_noise_is_not_significant_even_past_threshold() -> None:
    # The core bug this fix closes: window_size=2 (the config floor), a
    # single-observation swing (1 failure vs 0) produces score=0.5 -- which
    # clears a typical 0.2 failure_threshold by a wide margin -- but with
    # only 2 observations per side this is indistinguishable from chance.
    p_value = _fisher_exact_two_tailed_p_value(
        recent_failures=1, recent_total=2, baseline_failures=0, baseline_total=2
    )
    assert p_value == pytest.approx(1.0)
    assert _is_significant_drift(0.5, p_value, 0.2, 0.05) is False


def test_real_large_window_regression_is_significant() -> None:
    # A real regression at a production-sized window (default
    # drift_window_size=20): 50% recent failure rate vs 10% baseline.
    p_value = _fisher_exact_two_tailed_p_value(
        recent_failures=10, recent_total=20, baseline_failures=2, baseline_total=20
    )
    assert p_value < 0.05
    assert _is_significant_drift(0.4, p_value, 0.2, 0.05) is True


def test_is_significant_drift_requires_both_magnitude_and_significance() -> None:
    # Below the magnitude threshold: never significant, no matter the p-value.
    assert _is_significant_drift(0.1, 0.0, 0.2, 0.05) is False
    # Above the magnitude threshold but not statistically significant.
    assert _is_significant_drift(0.5, 0.5, 0.2, 0.05) is False
    # Above the magnitude threshold AND statistically significant.
    assert _is_significant_drift(0.5, 0.01, 0.2, 0.05) is True


def test_fisher_exact_p_value_is_symmetric_in_direction() -> None:
    # A recent-worse-than-baseline table and its mirror (baseline-worse-
    # than-recent) must produce the same two-tailed p-value -- the test
    # doesn't know or care which side "improved".
    worse = _fisher_exact_two_tailed_p_value(
        recent_failures=3, recent_total=5, baseline_failures=0, baseline_total=5
    )
    better = _fisher_exact_two_tailed_p_value(
        recent_failures=0, recent_total=5, baseline_failures=3, baseline_total=5
    )
    assert worse == pytest.approx(better)
