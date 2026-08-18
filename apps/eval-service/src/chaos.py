"""Deterministic fault-injection harness for hardening chaos scenarios."""

from dataclasses import dataclass

from src.db.launch_golden_sets import EvalCaseSeed


@dataclass(frozen=True)
class ChaosExecution:
    output: dict[str, object]
    diagnostic: str


_RESPONSES: dict[tuple[str, str, int], tuple[str, str]] = {
    ("orchestration", "unavailable", 1): ("degraded", "ask_user"),
    ("ads-query", "unavailable", 1): ("degraded", "continue_without_context"),
    ("model-gateway", "timeout", 1): ("recovered", "retry"),
    ("model-gateway", "timeout", 2): ("escalated", "swap_agent"),
    ("tool-provider", "rate_limit", 1): ("recovered", "backoff"),
    ("tool-provider", "unavailable", 1): ("recovered", "retry"),
    ("sandbox", "crash", 1): ("recovered", "retry"),
    ("sandbox", "crash", 2): ("recovered", "recompile"),
    ("worker", "lost", 1): ("recovered", "retry"),
    ("queue", "delayed", 1): ("recovered", "backoff"),
    ("request", "lost", 1): ("recovered", "retry"),
    ("verification", "unavailable", 1): ("blocked", "blocked_pending_recovery"),
    ("artifact-store", "unavailable", 1): ("degraded", "partial_result"),
    ("external-provider", "server_error", 1): ("recovered", "retry"),
    ("external-provider", "permission_denied", 1): ("blocked", "ask_user"),
}


class ChaosHarness:
    """Executes the deterministic resilience policy for injected boundary faults."""

    def execute(self, scenario: EvalCaseSeed) -> ChaosExecution:
        input_json = scenario.input_json
        if input_json.get("operation") != "chaos_inject":
            raise ValueError("ChaosHarness accepts only chaos_inject cases")
        boundary = input_json.get("boundary")
        failure_mode = input_json.get("failure_mode")
        attempt = input_json.get("attempt")
        if (
            not isinstance(boundary, str)
            or not isinstance(failure_mode, str)
            or not isinstance(attempt, int)
        ):
            raise ValueError("Chaos scenarios require boundary, failure_mode, and integer attempt")
        response = _RESPONSES.get((boundary, failure_mode, attempt))
        if response is None:
            raise ValueError(
                f"No resilience policy for {boundary}/{failure_mode} attempt {attempt}"
            )
        outcome, strategy = response
        return ChaosExecution(
            output={"outcome": outcome, "strategy": strategy},
            diagnostic=f"{boundary}:{failure_mode}:attempt={attempt}:{strategy}",
        )
