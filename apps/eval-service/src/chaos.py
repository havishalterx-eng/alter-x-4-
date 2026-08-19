"""Deterministic fault-injection harness for hardening chaos scenarios."""

from dataclasses import dataclass

from src.db.launch_golden_sets import EvalCaseSeed


@dataclass(frozen=True)
class ChaosExecution:
    output: dict[str, object]
    diagnostic: str


_RESPONSES: dict[tuple[str, int], tuple[str, str]] = {
    ("credential_missing", 1): ("escalated", "repair"),
    ("safety_violation", 1): ("escalated", "ask_user"),
    ("tool_permission_denial", 1): ("escalated", "ask_user"),
    ("rate_limit", 1): ("resolved", "backoff"),
    ("timeout", 1): ("resolved", "retry"),
    ("timeout", 2): ("escalated", "swap_agent"),
    ("infrastructure_failure", 1): ("resolved", "retry"),
    ("infrastructure_failure", 2): ("escalated", "swap_agent"),
    ("sandbox_crash", 1): ("resolved", "retry"),
    ("sandbox_crash", 2): ("resolved", "recompile"),
    ("logic_output_failure", 1): ("resolved", "escalate_model"),
    ("logic_output_failure", 2): ("resolved", "replan"),
    ("agent_creation_failure", 1): ("escalated", "swap_agent"),
    ("agent_creation_failure", 2): ("escalated", "ask_user"),
    ("unknown", 1): ("escalated", "ask_user"),
}


class ChaosHarness:
    """Executes deterministic recovery policy for injected failure classes."""

    def execute(self, scenario: EvalCaseSeed) -> ChaosExecution:
        input_json = scenario.input_json
        if input_json.get("operation") != "chaos_inject":
            raise ValueError("ChaosHarness accepts only chaos_inject cases")
        failure_class = input_json.get("failure_class")
        node_attempt = input_json.get("node_attempt")
        if (
            not isinstance(failure_class, str)
            or not isinstance(node_attempt, int)
        ):
            raise ValueError("Chaos scenarios require failure_class and integer node_attempt")
        response = _RESPONSES.get((failure_class, node_attempt))
        if response is None:
            raise ValueError(
                f"No resilience policy for {failure_class} node_attempt {node_attempt}"
            )
        outcome, strategy = response
        return ChaosExecution(
            output={"outcome": outcome, "strategy": strategy},
            diagnostic=f"{failure_class}:node_attempt={node_attempt}:{strategy}",
        )
