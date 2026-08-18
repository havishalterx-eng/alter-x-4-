"""Versioned deterministic chaos cases for Phase 9 hardening."""

from uuid import NAMESPACE_URL, UUID, uuid5

from .launch_golden_sets import EvalCaseSeed, GoldenSetSeed


def _id(value: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"https://alterx.dev/eval/{value}")


def _scenario(
    name: str,
    boundary: str,
    failure_mode: str,
    attempt: int,
    outcome: str,
    strategy: str,
) -> EvalCaseSeed:
    return EvalCaseSeed(
        input_json={
            "operation": "chaos_inject",
            "name": name,
            "boundary": boundary,
            "failure_mode": failure_mode,
            "attempt": attempt,
        },
        expected_json={"outcome": outcome, "strategy": strategy},
        scoring={"matcher": "exact_json", "minimum_score": 1.0},
        tags=["hardening", "chaos", boundary, failure_mode],
    )


CHAOS_CASES: tuple[EvalCaseSeed, ...] = (
    _scenario(
        "orchestration-interruption", "orchestration", "unavailable", 1, "degraded", "ask_user"
    ),
    _scenario(
        "ads-query-interruption",
        "ads-query",
        "unavailable",
        1,
        "degraded",
        "continue_without_context",
    ),
    _scenario("model-timeout-first", "model-gateway", "timeout", 1, "recovered", "retry"),
    _scenario("model-timeout-repeat", "model-gateway", "timeout", 2, "escalated", "swap_agent"),
    _scenario("provider-rate-limit", "tool-provider", "rate_limit", 1, "recovered", "backoff"),
    _scenario(
        "provider-transient-failure", "tool-provider", "unavailable", 1, "recovered", "retry"
    ),
    _scenario("sandbox-crash-first", "sandbox", "crash", 1, "recovered", "retry"),
    _scenario("sandbox-crash-repeat", "sandbox", "crash", 2, "recovered", "recompile"),
    _scenario("worker-disruption", "worker", "lost", 1, "recovered", "retry"),
    _scenario("queue-delay", "queue", "delayed", 1, "recovered", "backoff"),
    _scenario("request-loss", "request", "lost", 1, "recovered", "retry"),
    _scenario(
        "verification-interruption",
        "verification",
        "unavailable",
        1,
        "blocked",
        "blocked_pending_recovery",
    ),
    _scenario(
        "artifact-store-interruption",
        "artifact-store",
        "unavailable",
        1,
        "degraded",
        "partial_result",
    ),
    _scenario(
        "external-provider-5xx", "external-provider", "server_error", 1, "recovered", "retry"
    ),
    _scenario(
        "external-provider-permission",
        "external-provider",
        "permission_denied",
        1,
        "blocked",
        "ask_user",
    ),
)


CHAOS_GOLDEN_SET = GoldenSetSeed(
    _id("golden-set/chaos/v1"), "chaos", "hardening", 1, CHAOS_CASES
)
