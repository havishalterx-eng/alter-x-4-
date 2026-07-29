import pytest

from src.verification.models import SafetyAssessment


@pytest.mark.parametrize("severity", ["low", "medium", "high"])
def test_noncritical_severity_signals_heal(severity: str) -> None:
    assessment = SafetyAssessment.model_validate({"severity": severity, "rationale": "repairable"})
    assert assessment.recovery_signal == "heal"
