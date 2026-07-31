from src.promotion_gate import evaluate_promotion


def passing_evidence() -> dict[str, object]:
    return {
        "subject": "engine",
        "candidate": "sha256:release-candidate",
        "environment": "staging_to_prod",
        "metrics": {
            "intent": 0.95,
            "planner": 0.9,
            "critical_edges": 1,
            "retrieval_recall": 0.9,
            "verification_false_pass": 0.019,
            "recovery": 0.9,
            "injection_block": 0.98,
            "cross_tenant_leakage": 0,
            "unsafe_external_action": 0,
        },
        "checks": {
            "staging_e2e": True,
            "golden_sets": True,
            "redteam": True,
            "chaos": True,
            "load_slo": True,
            "backup_restore": True,
            "deletion_ledger_replay": True,
            "canary_rollback": True,
        },
        "approvals": ["subsystem_owners", "ceo", "product_owner"],
    }


def test_promotion_gate_approves_only_complete_evidence() -> None:
    decision = evaluate_promotion(passing_evidence())
    assert decision.decision == "approved"
    assert decision.backend_complete is True
    assert decision.reasons == ()


def test_promotion_gate_blocks_missing_evidence_and_threshold_failures() -> None:
    evidence = passing_evidence()
    evidence["metrics"] = {"intent": 0.94, "verification_false_pass": 0.02}
    evidence["checks"] = {"golden_sets": True, "backup_restore": False}
    evidence["approvals"] = ["ceo"]
    decision = evaluate_promotion(evidence)
    assert decision.decision == "blocked"
    assert decision.backend_complete is False
    assert "metric_failed:intent:0.94>=0.95" in decision.reasons
    assert "metric_failed:verification_false_pass:0.02<0.02" in decision.reasons
    assert "missing_or_failed_check:backup_restore" in decision.reasons
    assert "missing_approval:product_owner" in decision.reasons


def test_promotion_gate_rejects_an_unsafe_environment_even_when_everything_else_passes() -> None:
    evidence = passing_evidence()
    evidence["environment"] = "prod"
    decision = evaluate_promotion(evidence)
    assert decision.decision == "blocked"
    assert "invalid_environment:staging_to_prod_required" in decision.reasons
