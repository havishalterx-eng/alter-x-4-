"""Planner tool-naming golden set, fixed before the prompt change it scores,
and a live run of the real planner against it.

A tool node's ``tool_name`` is dispatched by the Tool Gateway, which runs
exactly the canonical tools (``CANONICAL_TOOL_SIDE_EFFECTS``). A name outside
that list cannot run, and synthesis still puts an approval before it, so a
person approves an action that then fails at dispatch.

Two rules, derived from that and not from any model's current output:

1. Every tool node names a canonical tool. This applies to every case.
2. When the objective asks for an action a canonical tool performs, the plan
   uses that tool (``required``).

The second half of the set asks for actions no canonical tool performs
(YouTube, Slack, Jira, SMS, calendars, video rendering). Those have no
required tool; they pass when the plan invents none.

The live run needs a live Model Gateway, so it runs only when
PLANNER_TOOL_NAMING_LIVE_MODEL_GATEWAY is set (to anything). Settings come
from the environment exactly as the service reads them. Set
PLANNER_TOOL_NAMING_RESULTS to a file path to keep every case's tool names.

It reports rather than asserts a threshold: the number is the evidence, and
a model's plans vary between runs.
"""

import json
import os
import uuid
from dataclasses import dataclass

import pytest

from src.capability_registry.canonical_tools import CANONICAL_TOOL_SIDE_EFFECTS
from src.config import get_settings
from src.m2m_auth import lazy_auth0_m2m_token_provider_from_settings
from src.planner.model_gateway_llm_client import ModelGatewayLlmClient
from src.problem_understanding.models import ProblemSpec, problem_spec_json

pytestmark = pytest.mark.skipif(
    not os.environ.get("PLANNER_TOOL_NAMING_LIVE_MODEL_GATEWAY"),
    reason="needs a live Model Gateway (set PLANNER_TOOL_NAMING_LIVE_MODEL_GATEWAY)",
)


@dataclass(frozen=True)
class ToolNamingCase:
    key: str
    objective: str
    required: frozenset[str]


TOOL_NAMING_CASES: tuple[ToolNamingCase, ...] = (
    ToolNamingCase(
        "search-news",
        "Search the web for the three most recent announcements from the EU AI Office and "
        "summarise each in two sentences.",
        frozenset({"search.web"}),
    ),
    ToolNamingCase(
        "email-status",
        "Email a short weekly status summary to ops-lead@example.com with the subject "
        "'Weekly status', saying that all three launches shipped on time.",
        frozenset({"email.send"}),
    ),
    ToolNamingCase(
        "db-count",
        "Count how many orders have status 'pending' in our orders database (database id "
        "orders_db, table orders).",
        frozenset({"database.select"}),
    ),
    ToolNamingCase(
        "db-update",
        "Mark order 1042 as shipped in our orders database (database id orders_db, table "
        "orders, column status).",
        frozenset({"database.update"}),
    ),
    ToolNamingCase(
        "browser-prices",
        "Open https://example.com/pricing in a browser and extract the listed plan prices.",
        frozenset({"browser.extract"}),
    ),
    ToolNamingCase(
        "search-then-email",
        "Find today's closing price of the S&P 500 online and email it to me at me@example.com.",
        frozenset({"search.web", "email.send"}),
    ),
    ToolNamingCase(
        "youtube-upload",
        "Upload the finished product demo video to our YouTube channel.",
        frozenset(),
    ),
    ToolNamingCase(
        "slack-post",
        "Post a message in the #launch Slack channel announcing that version 2.0 is live.",
        frozenset(),
    ),
    ToolNamingCase(
        "jira-ticket",
        "Create a Jira ticket for the login timeout bug and assign it to the backend team.",
        frozenset(),
    ),
    ToolNamingCase(
        "video-render",
        "Render a 30-second promotional video from the storyboard in our brand kit.",
        frozenset(),
    ),
    ToolNamingCase(
        "sms-oncall",
        "Send an SMS to the on-call engineer saying the primary database is down.",
        frozenset(),
    ),
    ToolNamingCase(
        "calendar-invite",
        "Add a meeting to my Google Calendar for Friday at 3pm with the design team.",
        frozenset(),
    ),
)


def _fresh_tenant_id() -> str:
    # The Model Gateway caches answers per tenant by prompt similarity, and the
    # fixed part of a planning payload (the system prompt) dominates that
    # similarity: inside one tenant, a second objective scores above the
    # threshold against the first and replays its plan. So every case plans as
    # a tenant the cache has never seen, not just every run.
    hex_ = uuid.uuid4().hex
    return f"ten_{hex_[:8]}-{hex_[8:12]}-7{hex_[13:16]}-8{hex_[17:20]}-{hex_[20:]}"


async def test_planner_tool_naming_golden_set() -> None:
    settings = get_settings()
    client = ModelGatewayLlmClient(
        settings.model_gateway_grpc_target,
        timeout_seconds=120,
        access_token_provider=lazy_auth0_m2m_token_provider_from_settings(settings),
    )
    results = []
    try:
        for case in TOOL_NAMING_CASES:
            spec = ProblemSpec(objective=case.objective, risk="low")
            try:
                skeleton = await client.generate_skeleton(
                    tenant_id=_fresh_tenant_id(),
                    run_id=f"run_{uuid.uuid4()}",
                    strategy="iterative",
                    problem_spec_json=problem_spec_json(spec),
                )
            except Exception as error:  # noqa: BLE001 -- recorded per case
                results.append({"case": case.key, "error": str(error), "passed": False})
                continue
            names = [
                str(node.config.get("tool_name")) for node in skeleton.nodes if node.type == "tool"
            ]
            invented = sorted({name for name in names if name not in CANONICAL_TOOL_SIDE_EFFECTS})
            missing = sorted(case.required - set(names))
            results.append(
                {
                    "case": case.key,
                    "tool_names": names,
                    "invented": invented,
                    "missing": missing,
                    "passed": not invented and not missing,
                }
            )
    finally:
        await client.close()

    passed = sum(1 for result in results if result["passed"])
    summary = {"passed": passed, "total": len(results), "cases": results}
    output = os.environ.get("PLANNER_TOOL_NAMING_RESULTS")
    if output:
        with open(output, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=2)
    print(json.dumps(summary, indent=2))  # noqa: T201 -- the score is the output
    assert len(results) == len(TOOL_NAMING_CASES)
