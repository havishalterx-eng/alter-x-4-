"""Versioned launch-floor evaluation content for HARD-2.

The cases intentionally describe existing contracts only. They are data for a
future runner, not an evaluation implementation in this service.
"""

from dataclasses import dataclass
from uuid import NAMESPACE_URL, UUID, uuid5


@dataclass(frozen=True)
class EvalCaseSeed:
    input_json: dict[str, object]
    expected_json: dict[str, object]
    scoring: dict[str, object]
    tags: list[str]


@dataclass(frozen=True)
class GoldenSetSeed:
    id: UUID
    name: str
    domain: str
    version: int
    cases: tuple[EvalCaseSeed, ...]


def _id(value: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"https://alterx.dev/eval/{value}")


def _exact_case(
    input_json: dict[str, object], expected_json: dict[str, object], tags: list[str]
) -> EvalCaseSeed:
    return EvalCaseSeed(
        input_json=input_json,
        expected_json=expected_json,
        scoring={"matcher": "exact_json", "minimum_score": 1.0},
        tags=["launch-floor", *tags],
    )


def _planner_strategy(objective: str, mode: str, strategy: str, tag: str) -> EvalCaseSeed:
    return _exact_case(
        {"operation": "select_strategy", "objective": objective, "mode": mode},
        {"strategy": strategy},
        ["planner", "strategy", tag],
    )


def _planner_ambiguity(objective: str, ambiguity_detected: bool, tag: str) -> EvalCaseSeed:
    return _exact_case(
        {"operation": "decompose", "objective": objective, "strategy": "iterative"},
        {"ambiguity_detected": ambiguity_detected},
        ["planner", "ambiguity", tag],
    )


PLANNER_CASES: tuple[EvalCaseSeed, ...] = (
    _planner_strategy("Fix a typo in the README", "workflow", "direct", "small-change"),
    _planner_strategy("Rename a mislabeled button", "workflow", "direct", "ui-copy"),
    _planner_strategy("Format the project changelog", "workflow", "direct", "documentation"),
    _planner_strategy("Summarize this incident report", "workflow", "direct", "summary"),
    _planner_strategy(
        "Coordinate a deployment across several regions", "workflow", "iterative", "deployment"
    ),
    _planner_strategy(
        "Investigate why the nightly backup failed", "workflow", "iterative", "investigation"
    ),
    _planner_strategy(
        "Migrate the API one endpoint at a time", "workflow", "iterative", "migration"
    ),
    _planner_strategy(
        "Resolve intermittent checkout failures", "workflow", "iterative", "debugging"
    ),
    _planner_strategy("Build me a small app", "project", "plan_then_execute", "new-project"),
    _planner_strategy(
        "Create a customer feedback dashboard", "project", "plan_then_execute", "dashboard"
    ),
    _planner_strategy(
        "Design an internal onboarding portal", "project", "plan_then_execute", "product-build"
    ),
    _planner_strategy(
        "Build a simple inventory tracker", "project", "plan_then_execute", "application"
    ),
    _planner_strategy(
        "Coordinate every team to migrate a legacy database, deploy services, review "
        "configurations, research compliance, design rollback, write tests, and report progress",
        "workflow",
        "manager_worker",
        "multi-team",
    ),
    _planner_strategy(
        "Plan a global security remediation involving infrastructure, applications, "
        "compliance, communications, validation, and executive reporting",
        "workflow",
        "manager_worker",
        "security-program",
    ),
    _planner_strategy(
        "Run a cross-region disaster recovery exercise with database, platform, support, "
        "and documentation workstreams",
        "workflow",
        "manager_worker",
        "disaster-recovery",
    ),
    _planner_strategy(
        "Deliver a company-wide platform modernization across discovery, architecture, "
        "implementation, testing, rollout, and training teams",
        "workflow",
        "manager_worker",
        "modernization",
    ),
    _planner_ambiguity(
        "Handle the quarterly project the way we discussed before", True, "missing-context"
    ),
    _planner_ambiguity(
        "Prepare the launch plan using the usual approach", True, "implicit-reference"
    ),
    _planner_ambiguity("Summarize this document quickly", False, "clear-request"),
    _planner_ambiguity(
        "Create a rollback checklist for the API release", False, "specific-request"
    ),
)


def _intent(utterance: str, intent: str, tag: str) -> EvalCaseSeed:
    return _exact_case(
        {"operation": "classify_intent", "utterance": utterance},
        {"intent": intent, "actionable": intent != "answer"},
        ["intent", intent, tag],
    )


INTENT_CASES: tuple[EvalCaseSeed, ...] = (
    _intent("What does the deployment status mean?", "answer", "status-question"),
    _intent("How do I reset my password?", "answer", "how-to"),
    _intent("Which environments are currently healthy?", "answer", "environment-question"),
    _intent("Explain the difference between a Gate and HumanApproval node", "answer", "concept"),
    _intent("When was the last backup completed?", "answer", "history-question"),
    _intent("Who owns the checkout service?", "answer", "ownership-question"),
    _intent("Plan a phased migration from the legacy API", "plan", "migration"),
    _intent("Help me plan the next release", "plan", "release"),
    _intent("Create a plan for reducing cloud spend", "plan", "cost"),
    _intent("Outline how we should investigate this outage", "plan", "incident"),
    _intent("Plan the onboarding work for a new engineer", "plan", "onboarding"),
    _intent("Draft a plan to improve search relevance", "plan", "retrieval"),
    _intent("Run the nightly database backup workflow", "workflow", "backup"),
    _intent("Start the release validation workflow", "workflow", "release-validation"),
    _intent("Trigger the customer import workflow", "workflow", "import"),
    _intent("Run the incident response workflow", "workflow", "incident-response"),
    _intent("Execute the monthly billing workflow", "workflow", "billing"),
    _intent("Run the staging smoke-test workflow", "workflow", "smoke-test"),
    _intent("Deploy the current service to staging", "execute", "deploy"),
    _intent("Restart the failed worker", "execute", "restart"),
    _intent("Generate the production access report", "execute", "report"),
    _intent("Create a new sandbox for this run", "execute", "sandbox"),
    _intent("Send the approved release announcement", "execute", "notification"),
    _intent("Apply the pending database migration", "execute", "migration"),
    _intent("Change the retry limit to three attempts", "modify", "configuration"),
    _intent("Update the workflow owner to the platform team", "modify", "ownership"),
    _intent("Rename the checkout alert policy", "modify", "rename"),
    _intent("Remove the deprecated staging trigger", "modify", "remove"),
    _intent("Add a human approval step before production deploys", "modify", "workflow-edit"),
    _intent("Change the project budget to fifty dollars", "modify", "budget"),
)


def _retrieval(query: str, document_key: str, tag: str) -> EvalCaseSeed:
    return EvalCaseSeed(
        input_json={"operation": "retrieve", "query": query, "scope": "workspace"},
        expected_json={"expected_document_key": document_key},
        scoring={"matcher": "contains_document", "rank_at_most": 10, "minimum_score": 1.0},
        tags=["launch-floor", "retrieval", "workspace-scope", tag],
    )


RETRIEVAL_CASES: tuple[EvalCaseSeed, ...] = (
    _retrieval("refund policy for unused purchases", "doc_refund", "returns"),
    _retrieval("how can a user reset a forgotten password", "doc_password", "account"),
    _retrieval("how long does standard shipping take", "doc_shipping", "delivery"),
    _retrieval("what does the product warranty cover", "doc_warranty", "warranty"),
    _retrieval("cancel an account subscription", "doc_cancellation", "subscription"),
    _retrieval("how is customer information handled", "doc_privacy", "privacy"),
    _retrieval("which payment methods can customers use", "doc_payment", "billing"),
    _retrieval("how do I contact customer support", "doc_support", "support"),
    _retrieval("damaged item return for store credit", "doc_distractor_returns", "returns"),
    _retrieval("enterprise single sign-on login", "doc_distractor_login", "account"),
    _retrieval("is expedited delivery available", "doc_distractor_delivery", "delivery"),
    _retrieval("when is an invoice payment due", "doc_distractor_billing", "billing"),
    _retrieval("thirty day return window", "doc_refund", "returns"),
    _retrieval("forgot password link on login page", "doc_password", "account"),
    _retrieval("shipping destination affects delivery time", "doc_shipping", "delivery"),
    _retrieval("manufacturing defect coverage period", "doc_warranty", "warranty"),
    _retrieval("where are subscription cancellation settings", "doc_cancellation", "subscription"),
    _retrieval("do you sell customer data to third parties", "doc_privacy", "privacy"),
    _retrieval("bank transfer accepted for purchases", "doc_payment", "billing"),
    _retrieval("support email chat and phone hours", "doc_support", "support"),
)


def _verification(
    node_type: str, output_json: str, verdict: str, threshold: float, tag: str
) -> EvalCaseSeed:
    return _exact_case(
        {
            "operation": "score_node",
            "node_type": node_type,
            "config_json": "{}",
            "output_json": output_json,
        },
        {"verdict": verdict, "threshold": threshold},
        ["verification", node_type.lower(), tag],
    )


VERIFICATION_CASES: tuple[EvalCaseSeed, ...] = (
    _verification("Gate", '{"routed":true}', "pass", 1.0, "structured-pass"),
    _verification("HumanApproval", '{"approved":true}', "pass", 1.0, "structured-pass"),
    _verification("Merge", '{"items":["a","b"]}', "pass", 1.0, "structured-pass"),
    _verification("MemoryWrite", '{"record":"saved"}', "pass", 1.0, "structured-pass"),
    _verification("PubSub", '{"published":true}', "pass", 1.0, "structured-pass"),
    _verification("GroupChat", '{"messages":1}', "pass", 1.0, "structured-pass"),
    _verification("YAMLImport", '{"workflow":"loaded"}', "pass", 1.0, "structured-pass"),
    _verification("Gate", "{}", "fail", 1.0, "empty-output"),
    _verification("HumanApproval", "null", "fail", 1.0, "null-output"),
    _verification("Merge", "{not json", "fail", 1.0, "malformed-output"),
    _verification("MemoryWrite", "{}", "fail", 1.0, "empty-output"),
    _verification("PubSub", "null", "fail", 1.0, "null-output"),
    _verification("GroupChat", "{not json", "fail", 1.0, "malformed-output"),
    _verification("YAMLImport", "{}", "fail", 1.0, "empty-output"),
    _verification("LLMTask", '{"content":"complete answer"}', "pass", 0.7, "reviewer-pass"),
    _verification("ToolCall", '{"result":"customer found"}', "pass", 0.7, "reviewer-pass"),
    _verification(
        "SandboxExec", '{"files":["app.py"],"tests":"passed"}', "pass", 0.7, "reviewer-pass"
    ),
    _verification(
        "Synthesis", '{"summary":"combined upstream findings"}', "pass", 0.7, "reviewer-pass"
    ),
    _verification("LLMTask", "{}", "fail", 0.7, "reviewer-empty"),
    _verification("ToolCall", "null", "fail", 0.7, "reviewer-null"),
)


LAUNCH_GOLDEN_SETS: tuple[GoldenSetSeed, ...] = (
    GoldenSetSeed(_id("golden-set/planner/v1"), "planner", "planner", 1, PLANNER_CASES),
    GoldenSetSeed(_id("golden-set/intent/v1"), "intent", "intent", 1, INTENT_CASES),
    GoldenSetSeed(_id("golden-set/retrieval/v1"), "retrieval", "retrieval", 1, RETRIEVAL_CASES),
    GoldenSetSeed(
        _id("golden-set/verification/v1"), "verification", "verification", 1, VERIFICATION_CASES
    ),
)


def case_id(golden_set: GoldenSetSeed, position: int) -> UUID:
    return _id(f"golden-set/{golden_set.name}/v{golden_set.version}/case/{position}")
