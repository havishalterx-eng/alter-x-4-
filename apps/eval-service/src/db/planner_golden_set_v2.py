"""Planner golden set v2: strategy cases that separate what an objective says
from how it is phrased.

Phase 4 of the action plan rewrites strategy selection, and requires its golden
set to be fixed *before* the rewrite so the target cannot be fitted afterwards.
v1 cannot serve as that target. Its four manager_worker cases are all
comma-separated lists of workstreams, and the heuristic that v1 is scored
against was changed to count commas precisely so that those four would pass
(see strategies.py). A set whose hard cases share one surface feature rewards
detecting that feature, which is the failure the rewrite exists to remove.

v2 keeps all twenty v1 cases unchanged and adds twenty that break the
correlation between surface form and scope in both directions:

- padding and incidental keywords on single-step work, which must stay direct;
- terse objectives covering several independent large workstreams, which must
  escalate to manager_worker;
- comma lists that describe one sequential pipeline, which must stay iterative
  rather than fanning out;
- multi-step work that needs validation between steps but uses none of the
  keywords the heuristic listens for, which must be iterative;
- project-mode objectives phrased as trivial or as sprawling programmes, which
  must be plan_then_execute regardless.

Every expected strategy follows from the definitions in
apps/intelligence-service/src/planner/strategies.py, not from what any
implementation currently returns:

  direct            single-step execution, no decomposition required
  iterative         multi-step, with intermediate validation gates
  plan_then_execute always, for mode "project"
  manager_worker    several independent large workstreams, fanned out to
                    parallel workers under one manager; workflow mode only
"""

from src.db.launch_golden_sets import (
    PLANNER_CASES,
    EvalCaseSeed,
    GoldenSetSeed,
    _id,
    _planner_strategy,
)

V1_GOLDEN_SET_ID = _id("golden-set/planner/v1")

# Padding, politeness and incidental keywords on work that is one step.
_PADDED_SINGLE_STEP: tuple[EvalCaseSeed, ...] = (
    _planner_strategy(
        "When you get a moment, and there is honestly no rush at all on this, could you "
        "please tell me which version number is currently listed in our package manifest file",
        "workflow",
        "direct",
        "v2-padded-lookup",
    ),
    _planner_strategy(
        "Please take a quick look at the release notes and fix the one misspelling in the "
        "second heading, where it says recieve instead of receive, thank you so much",
        "workflow",
        "direct",
        "v2-padded-typo",
    ),
    _planner_strategy(
        "Review the spelling of the word deploy in the page footer",
        "workflow",
        "direct",
        "v2-keyword-review",
    ),
    _planner_strategy(
        "Summarize the three bullet points in this message",
        "workflow",
        "direct",
        "v2-keyword-summarize",
    ),
    _planner_strategy(
        "Generate a one-line commit message for this diff",
        "workflow",
        "direct",
        "v2-keyword-generate",
    ),
)

# Several independent large workstreams, stated without an enumerated list.
_TERSE_PARALLEL_PROGRAMMES: tuple[EvalCaseSeed, ...] = (
    _planner_strategy(
        "Migrate all twelve country storefronts to the new payments provider",
        "workflow",
        "manager_worker",
        "v2-terse-per-country",
    ),
    _planner_strategy(
        "Move three product teams' services onto the new cloud platform in every region we operate",
        "workflow",
        "manager_worker",
        "v2-terse-multi-team",
    ),
    _planner_strategy(
        "Get engineering, legal and HR each ready for the SOC 2 audit in parallel",
        "workflow",
        "manager_worker",
        "v2-terse-three-functions",
    ),
    _planner_strategy(
        "Localize the whole product into Japanese, German and Brazilian Portuguese at the "
        "same time",
        "workflow",
        "manager_worker",
        "v2-terse-locales",
    ),
)

# Comma lists describing one sequential pipeline: several steps, one workstream.
_SEQUENTIAL_LISTS: tuple[EvalCaseSeed, ...] = (
    _planner_strategy(
        "Download the export CSV, clean up the header row, remove duplicate rows, convert the "
        "dates to ISO format, and load the result into the warehouse",
        "workflow",
        "iterative",
        "v2-list-etl-pipeline",
    ),
    _planner_strategy(
        "Open the failing ticket, read the service logs, find the request that errors, patch "
        "the handler, and redeploy the fix",
        "workflow",
        "iterative",
        "v2-list-debug-sequence",
    ),
    _planner_strategy(
        "Draft the announcement, get it checked for tone, fix what the reviewer flags, and "
        "then post it to the customer newsletter",
        "workflow",
        "iterative",
        "v2-list-review-loop",
    ),
)

# Multi-step work needing validation between steps, with no trigger keywords.
_UNKEYWORDED_MULTI_STEP: tuple[EvalCaseSeed, ...] = (
    _planner_strategy(
        "Find out why invoices from last Tuesday were charged twice and refund the customers "
        "affected",
        "workflow",
        "iterative",
        "v2-plain-investigate-then-act",
    ),
    _planner_strategy(
        "Rotate the production database credentials without any downtime",
        "workflow",
        "iterative",
        "v2-plain-zero-downtime",
    ),
    _planner_strategy(
        "Upgrade the payments SDK and make sure checkout still works afterwards",
        "workflow",
        "iterative",
        "v2-plain-change-then-verify",
    ),
    _planner_strategy(
        "Tune the search ranking until the top result for our ten benchmark queries is correct",
        "workflow",
        "iterative",
        "v2-plain-loop-to-target",
    ),
)

# Project mode is plan_then_execute whatever the objective looks like.
_PROJECT_MODE_REGARDLESS: tuple[EvalCaseSeed, ...] = (
    _planner_strategy("Make a to-do list", "project", "plan_then_execute", "v2-project-trivial"),
    _planner_strategy(
        "Coordinate the billing, identity and notifications teams to rebuild their services, "
        "migrate data, and roll out across every region",
        "project",
        "plan_then_execute",
        "v2-project-sprawling",
    ),
    _planner_strategy(
        "Fix a typo on the landing page",
        "project",
        "plan_then_execute",
        "v2-project-single-step-phrasing",
    ),
    _planner_strategy(
        "Build an internal tool that summarizes support tickets",
        "project",
        "plan_then_execute",
        "v2-project-keyword",
    ),
)

V2_ADDED_CASES: tuple[EvalCaseSeed, ...] = (
    *_PADDED_SINGLE_STEP,
    *_TERSE_PARALLEL_PROGRAMMES,
    *_SEQUENTIAL_LISTS,
    *_UNKEYWORDED_MULTI_STEP,
    *_PROJECT_MODE_REGARDLESS,
)

PLANNER_CASES_V2: tuple[EvalCaseSeed, ...] = (*PLANNER_CASES, *V2_ADDED_CASES)

PLANNER_GOLDEN_SET_V2 = GoldenSetSeed(
    _id("golden-set/planner/v2"), "planner", "planner", 2, PLANNER_CASES_V2
)
