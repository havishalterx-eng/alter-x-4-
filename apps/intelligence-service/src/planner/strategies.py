"""Workflow strategy selection.

Four strategies exist on the planner:
- DIRECT           -- single-step execution, no decomposition required.
- ITERATIVE        -- multi-step with intermediate validation gates.
- PLAN_THEN_EXECUTE -- full decomposition first, batch execution after approval
                       (always used for mode="project"; see project_strategy.py).
- MANAGER_WORKER   -- objective spans several independent large workstreams;
                       fanned out to parallel worker agents under one manager
                       (see manager_worker.py). Only escalated to from
                       mode="workflow" -- Project-mode work always needs its
                       fixed build pipeline regardless of scale, so it is
                       never overridden by this escalation.

SelectStrategy is a deterministic heuristic; it never calls the LLM.  The
heuristic is intentionally conservative: when in doubt, choose a more
deliberate strategy to avoid silent failures during execution.
"""

STRATEGY_DIRECT = "direct"
STRATEGY_ITERATIVE = "iterative"
STRATEGY_PLAN_THEN_EXECUTE = "plan_then_execute"
STRATEGY_MANAGER_WORKER = "manager_worker"

# A workflow objective escalates to ManagerWorker when it enumerates several
# distinct workstreams and is substantial enough for the fan-out to pay for
# itself. Conservative on purpose: iterative is a safe default, so we only fan
# out to parallel agents when the objective clearly can't be served by a single
# execution path.
#
# This replaced a 40-word / 3-keyword rule that no realistic objective reached.
# All four of the planner golden set's manager_worker cases failed under it --
# the longest is 26 words -- so the branch was dead in practice, while padding
# a trivial objective past 40 words with incidental keyword hits did escalate.
# Counting enumerated workstreams is a better proxy: it is what the escalation
# is for, and it does not reward verbosity.
#
# It is still a proxy. An objective describing genuinely parallel work in one
# clause without enumerating it stays iterative -- see
# TestStrategySelectionTracksSurfaceFormNotActualScope in
# tests/test_planner_strategies.py, which keeps asserting that limit rather
# than hiding it.
_MANAGER_WORKER_ENUMERATED_ITEMS = 4
_MANAGER_WORKER_LENGTH_THRESHOLD = 80

# Keywords in the objective that signal non-trivial multi-step work.
_COMPLEX_KEYWORDS = frozenset(
    {
        "all",
        "batch",
        "bulk",
        "compare",
        "compile",
        "coordinate",
        "create",
        "deploy",
        "design",
        "each",
        "every",
        "generate",
        "migrate",
        "multiple",
        "orchestrate",
        "plan",
        "produce",
        "report",
        "research",
        "review",
        "schedule",
        "summarize",
        "synthesize",
    }
)

# Objective character-count threshold above which we escalate to iterative.
_ITERATIVE_LENGTH_THRESHOLD = 120


def _enumerated_workstreams(objective: str) -> int:
    """Count the comma-separated items in the objective.

    A trailing "and" list ("a, b, c, and d") is four items and three commas, so
    the count is commas plus one. An objective with no commas is one item,
    which is what keeps every short objective out of the ManagerWorker branch
    without needing a separate guard.
    """
    return objective.count(",") + 1


def select_strategy(objective: str, mode: str) -> tuple[str, str]:
    """Return (strategy, reason) for the given objective and mode.

    mode "project"  → always PLAN_THEN_EXECUTE (project-scope work requires
                       an explicit plan approval before any execution).
    mode "workflow" → heuristic based on objective complexity.
    anything else   → ITERATIVE (safe default for unknown modes).
    """
    if mode == "project":
        return (
            STRATEGY_PLAN_THEN_EXECUTE,
            "Project-mode work requires an explicit plan approval before execution.",
        )

    if mode == "workflow":
        words = set(objective.lower().split())
        complex_hits = words & _COMPLEX_KEYWORDS
        enumerated = _enumerated_workstreams(objective)

        if (
            enumerated >= _MANAGER_WORKER_ENUMERATED_ITEMS
            and len(objective) >= _MANAGER_WORKER_LENGTH_THRESHOLD
        ):
            return (
                STRATEGY_MANAGER_WORKER,
                f"Objective enumerates {enumerated} distinct workstreams; fanning "
                "out to parallel manager/worker agents rather than a single "
                "execution path.",
            )

        is_complex = bool(complex_hits)
        is_long = len(objective) >= _ITERATIVE_LENGTH_THRESHOLD

        if not is_complex and not is_long:
            return (
                STRATEGY_DIRECT,
                "Workflow objective is concise and maps to a single execution step.",
            )
        return (
            STRATEGY_ITERATIVE,
            "Workflow objective complexity warrants intermediate validation gates.",
        )

    # Unknown mode — fall back to iterative so we never execute blindly.
    return (
        STRATEGY_ITERATIVE,
        f"Unrecognised mode '{mode}'; defaulting to iterative for safety.",
    )
