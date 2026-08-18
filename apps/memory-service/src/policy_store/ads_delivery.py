"""Bridges memory_learning/extraction.py's structured run-outcome content
into ADS Core's memory_namespace shape (a single-sentence `statement` plus
a `kind`). Deterministic and non-interpretive on purpose: it formats the
real fields the extraction step already computed into a plain sentence,
never infers or fabricates meaning beyond what those fields already say.
"""

from __future__ import annotations


def statement_for_run_content(content: dict[str, object]) -> str:
    verdict = content.get("final_verdict", "unknown")
    failed_nodes = content.get("failed_nodes")
    failed_count = len(failed_nodes) if isinstance(failed_nodes, list) else 0
    recovery_actions = content.get("recovery_actions")
    strategies = (
        sorted(
            {
                str(action["strategy"])
                for action in recovery_actions
                if isinstance(action, dict) and action.get("strategy")
            }
        )
        if isinstance(recovery_actions, list)
        else []
    )
    strategy_text = ", ".join(strategies) if strategies else "none"
    return (
        f"Run completed with verdict '{verdict}'; {failed_count} node(s) failed; "
        f"recovery strategies used: {strategy_text}."
    )
