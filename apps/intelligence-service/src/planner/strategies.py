"""Workflow strategy selection.

Three strategies exist on the planner:
- DIRECT           -- single-step execution, no decomposition required.
- ITERATIVE        -- multi-step with intermediate validation gates.
- PLAN_THEN_EXECUTE -- full decomposition first, batch execution after approval.

SelectStrategy is a deterministic heuristic; it never calls the LLM.  The
heuristic is intentionally conservative: when in doubt, choose a more
deliberate strategy to avoid silent failures during execution.
"""

STRATEGY_DIRECT = "direct"
STRATEGY_ITERATIVE = "iterative"
STRATEGY_PLAN_THEN_EXECUTE = "plan_then_execute"

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
        is_complex = bool(words & _COMPLEX_KEYWORDS)
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
