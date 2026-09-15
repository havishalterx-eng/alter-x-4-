"""Architecture golden set v1: the fixed target for the Phase 4 Synthesizer rewrite.

Written before the rewrite so the target cannot be fitted to it afterwards,
the same rule planner golden set v2 followed. Every expectation below is
hand-written from the rules in this docstring, never computed by code that
implements them -- a function deriving expectations would be a second
synthesizer, and the set would measure agreement between two implementations
rather than the product rules.

Input
-----
Each case gives the synthesizer what its contract already takes: a task
skeleton, its per-node requirements, and explicit SynthesisConstraints.
Deriving those constraints from a ProblemSpec, and passing them from the
platform pipeline (which passes none today), is separate pipeline work and is
deliberately not mixed into this score.

Rules
-----
Topology, waves and roles (unchanged product rules):

- topology is manager_worker when coordination_required; deterministic when
  the skeleton has no llm node; single for one llm node; parallel when any
  execution wave holds more than one node; sequential otherwise.
- execution waves are dependency levels of the source skeleton.
- roles: under manager_worker the entry node is the manager and every other
  llm node a worker; tool nodes are deterministic; branch and join nodes are
  control; any other llm node is direct.

Gates -- where verification and human approval sit. Output leaves a run in
two ways: a tool node acts on the outside world, or a terminal non-tool node
delivers the run's result.

- G1  Every tool node gets a verification gate BEFORE it, always. "Verification
      precedes every external action, no exceptions" (docs/specs/build phases/
      11-engine-backend-phases.md, Self-Healing Phase). A gate after an action
      has already happened verifies nothing.
- G2  verification_required, customer_visible or contains_pii: verification
      AFTER every terminal non-tool node.
- G3  human_approval_required or customer_visible: human approval BEFORE every
      tool node and AFTER every terminal non-tool node.
- Gates are a set: two rules asking for the same gate yield one gate, and a
  gate no rule asks for is a failure, not a harmless extra.

Residency and eligibility:

- A node with required capabilities is ready only if the Capability Registry
  holds an available record for them whose data_residency intersects
  allowed_data_residency. A record with no residency restriction is eligible
  under any constraint, and a residency-restricted record is eligible when the
  tenant sets no residency constraint.
- Otherwise the outcome is blocked, naming that node.

Scoring contract
----------------
A case passes when every key present in its expected facts matches the facts
extracted from the synthesizer's response (src/execution/architecture_scoring.py):
outcome, blocked_node, topology, waves, roles, gates. A gate is written
{"kind", "before": node} or {"kind", "after": node}. The current
ArchitectureSpec can only say after_node_key, so G1 and G3's before-gates
require the rewrite to add before_node_key to ArchitectureBoundary -- which is
the point of fixing the target first.

Confidence is not scored. Its target is "means something", and no per-case
expected value states that without inventing a number to match.
"""

from typing import Any

from src.db.launch_golden_sets import EvalCaseSeed, GoldenSetSeed, _id

ARCHITECTURE_EVAL_TENANT_ID = "ten_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa"
ARCHITECTURE_EVAL_WORKSPACE_ID = "ws_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa"

_SCORING = {"matcher": "architecture_facts", "minimum_score": 1.0}

# Registered once per eval run in the architecture eval tenant before any case
# runs. Only residency cases name these capabilities; every other case's nodes
# require no capability, so no other case depends on registry contents.
ARCHITECTURE_REGISTRY_FIXTURE: tuple[dict[str, Any], ...] = (
    {
        "capability_id": "arch-eval.summarize.eu",
        "kind": "model",
        "scope": "tenant",
        "supported_capabilities": ["arch_eval.summarize_eu_only"],
        "constraints": {"data_residency": ["eu"]},
        "provenance": {"source": "architecture-golden-set-v1"},
    },
    {
        "capability_id": "arch-eval.email.us",
        "kind": "tool",
        "scope": "tenant",
        "supported_capabilities": ["arch_eval.email_us_only"],
        "constraints": {"data_residency": ["us"]},
        "provenance": {"source": "architecture-golden-set-v1"},
    },
    {
        "capability_id": "arch-eval.translate.anywhere",
        "kind": "model",
        "scope": "tenant",
        "supported_capabilities": ["arch_eval.translate_unrestricted"],
        "provenance": {"source": "architecture-golden-set-v1"},
    },
)


# ---------------------------------------------------------------------------
# Skeleton builders -- shapes only; expectations are always written by hand.
# ---------------------------------------------------------------------------


def _llm(key: str, depends_on: tuple[str, ...] = (), prompt: str = "") -> dict[str, Any]:
    return {
        "key": key,
        "type": "llm",
        "config": {
            "model_alias": "STANDARD",
            "prompt": prompt or f"Do the {key.replace('_', ' ')} step.",
        },
        "depends_on": list(depends_on),
    }


def _tool(key: str, depends_on: tuple[str, ...] = (), tool_name: str = "") -> dict[str, Any]:
    return {
        "key": key,
        "type": "tool",
        "config": {"tool_name": tool_name or key, "arguments": {}},
        "depends_on": list(depends_on),
    }


def _control(key: str, kind: str, depends_on: tuple[str, ...]) -> dict[str, Any]:
    return {"key": key, "type": kind, "config": {}, "depends_on": list(depends_on)}


def _case(
    tag: str,
    nodes: list[dict[str, Any]],
    expected: dict[str, Any],
    *,
    constraints: dict[str, Any] | None = None,
    capabilities: dict[str, list[str]] | None = None,
) -> EvalCaseSeed:
    requirements = {
        node["key"]: {"capabilities": (capabilities or {}).get(node["key"], [])} for node in nodes
    }
    return EvalCaseSeed(
        {
            "operation": "synthesize",
            "task_skeleton": {"version": "1", "nodes": nodes, "entry_point": nodes[0]["key"]},
            "node_requirements": requirements,
            "constraints": constraints or {},
        },
        expected,
        _SCORING,
        ["launch-floor", "architecture", tag.split("-")[0], tag],
    )


def _before(kind: str, node: str) -> dict[str, str]:
    return {"kind": kind, "before": node}


def _after(kind: str, node: str) -> dict[str, str]:
    return {"kind": kind, "after": node}


# ---------------------------------------------------------------------------
# A. Shape: topology, waves and roles with no constraints set.
# ---------------------------------------------------------------------------

_SHAPE: tuple[EvalCaseSeed, ...] = (
    _case(
        "shape-single",
        [_llm("answer_question")],
        {
            "outcome": "ready",
            "topology": "single",
            "waves": [["answer_question"]],
            "roles": {"answer_question": "direct"},
            "gates": [],
        },
    ),
    _case(
        "shape-sequential",
        [_llm("outline"), _llm("draft", ("outline",)), _llm("polish", ("draft",))],
        {
            "outcome": "ready",
            "topology": "sequential",
            "waves": [["outline"], ["draft"], ["polish"]],
            "roles": {"outline": "direct", "draft": "direct", "polish": "direct"},
            "gates": [],
        },
    ),
    _case(
        "shape-parallel",
        [
            _llm("split_sources"),
            _llm("read_reviews", ("split_sources",)),
            _llm("read_tickets", ("split_sources",)),
            _control("combine", "join", ("read_reviews", "read_tickets")),
        ],
        {
            "outcome": "ready",
            "topology": "parallel",
            "waves": [["split_sources"], ["read_reviews", "read_tickets"], ["combine"]],
            "roles": {
                "split_sources": "direct",
                "read_reviews": "direct",
                "read_tickets": "direct",
                "combine": "control",
            },
            "gates": [],
        },
    ),
    _case(
        "shape-manager-worker",
        [
            _llm("plan_launch"),
            _llm("write_copy", ("plan_launch",)),
            _llm("price_plans", ("plan_launch",)),
            _control("assemble", "join", ("write_copy", "price_plans")),
        ],
        {
            "outcome": "ready",
            "topology": "manager_worker",
            "waves": [["plan_launch"], ["price_plans", "write_copy"], ["assemble"]],
            "roles": {
                "plan_launch": "manager",
                "write_copy": "worker",
                "price_plans": "worker",
                "assemble": "control",
            },
            "gates": [],
        },
        constraints={"coordination_required": True},
    ),
    _case(
        "shape-branch",
        [
            _llm("classify_request"),
            _control("route", "branch", ("classify_request",)),
            _llm("answer_billing", ("route",)),
        ],
        {
            "outcome": "ready",
            "topology": "sequential",
            "waves": [["classify_request"], ["route"], ["answer_billing"]],
            "roles": {"classify_request": "direct", "route": "control", "answer_billing": "direct"},
            "gates": [],
        },
    ),
)

# ---------------------------------------------------------------------------
# B. External actions: G1, a verification gate before every tool node.
# ---------------------------------------------------------------------------

_EXTERNAL_ACTIONS: tuple[EvalCaseSeed, ...] = (
    _case(
        "external-send-after-draft",
        [_llm("draft_reply"), _tool("send_email", ("draft_reply",), "email_send")],
        {
            "outcome": "ready",
            "topology": "sequential",
            "roles": {"draft_reply": "direct", "send_email": "deterministic"},
            "gates": [_before("verification", "send_email")],
        },
    ),
    _case(
        "external-deterministic-only",
        [
            _tool("export_orders", (), "shop_export"),
            _tool("upload_report", ("export_orders",), "drive_upload"),
        ],
        {
            "outcome": "ready",
            "topology": "deterministic",
            "waves": [["export_orders"], ["upload_report"]],
            "gates": [
                _before("verification", "export_orders"),
                _before("verification", "upload_report"),
            ],
        },
    ),
    _case(
        "external-action-mid-run",
        [
            _tool("fetch_invoice", (), "billing_read"),
            _llm("explain_charges", ("fetch_invoice",)),
        ],
        {
            "outcome": "ready",
            "topology": "sequential",
            "gates": [_before("verification", "fetch_invoice")],
        },
    ),
    _case(
        "external-parallel-actions",
        [
            _llm("prepare_announcement"),
            _tool("post_slack", ("prepare_announcement",), "slack_post"),
            _tool("post_status_page", ("prepare_announcement",), "statuspage_update"),
        ],
        {
            "outcome": "ready",
            "topology": "parallel",
            "waves": [["prepare_announcement"], ["post_slack", "post_status_page"]],
            "gates": [
                _before("verification", "post_slack"),
                _before("verification", "post_status_page"),
            ],
        },
    ),
    _case(
        "external-no-tool-no-gate",
        [_llm("summarize_notes"), _llm("list_actions", ("summarize_notes",))],
        {"outcome": "ready", "topology": "sequential", "gates": []},
    ),
)

# ---------------------------------------------------------------------------
# C. Constraint gates: G2 and G3.
# ---------------------------------------------------------------------------

_CONSTRAINT_GATES: tuple[EvalCaseSeed, ...] = (
    _case(
        "gates-verification-required",
        [_llm("analyse_contract"), _llm("flag_risks", ("analyse_contract",))],
        {
            "outcome": "ready",
            "topology": "sequential",
            "gates": [_after("verification", "flag_risks")],
        },
        constraints={"verification_required": True},
    ),
    _case(
        "gates-human-approval-required",
        [_llm("draft_policy"), _llm("format_policy", ("draft_policy",))],
        {
            "outcome": "ready",
            "topology": "sequential",
            "gates": [_after("human_approval", "format_policy")],
        },
        constraints={"human_approval_required": True},
    ),
    _case(
        "gates-customer-visible-text",
        [_llm("draft_answer"), _llm("tone_check", ("draft_answer",))],
        {
            "outcome": "ready",
            "gates": [
                _after("verification", "tone_check"),
                _after("human_approval", "tone_check"),
            ],
        },
        constraints={"customer_visible": True},
    ),
    _case(
        "gates-customer-visible-action",
        # The output leaves through the tool node, so approval belongs before
        # it; nothing is delivered after the send, so nothing gates after it.
        [_llm("write_newsletter"), _tool("send_newsletter", ("write_newsletter",), "email_bulk")],
        {
            "outcome": "ready",
            "gates": [
                _before("verification", "send_newsletter"),
                _before("human_approval", "send_newsletter"),
            ],
        },
        constraints={"customer_visible": True},
    ),
    _case(
        "gates-approval-before-mid-action",
        [
            _llm("propose_refund"),
            _tool("issue_refund", ("propose_refund",), "payments_refund"),
            _llm("write_confirmation", ("issue_refund",)),
        ],
        {
            "outcome": "ready",
            "topology": "sequential",
            "gates": [
                _before("verification", "issue_refund"),
                _before("human_approval", "issue_refund"),
                _after("human_approval", "write_confirmation"),
            ],
        },
        constraints={"human_approval_required": True},
    ),
    _case(
        "gates-all-constraints",
        # Same skeleton as shape-parallel. With every constraint set the
        # architecture must differ from the bare one -- the 4.2 defect was that
        # it did not beyond boundaries.
        [
            _llm("split_sources"),
            _llm("read_reviews", ("split_sources",)),
            _llm("read_tickets", ("split_sources",)),
            _control("combine", "join", ("read_reviews", "read_tickets")),
        ],
        {
            "outcome": "ready",
            "topology": "manager_worker",
            "roles": {
                "split_sources": "manager",
                "read_reviews": "worker",
                "read_tickets": "worker",
                "combine": "control",
            },
            "gates": [
                _after("verification", "combine"),
                _after("human_approval", "combine"),
            ],
        },
        constraints={
            "coordination_required": True,
            "verification_required": True,
            "human_approval_required": True,
            "customer_visible": True,
            "contains_pii": True,
            "allowed_data_residency": ["eu"],
        },
    ),
)

# ---------------------------------------------------------------------------
# D. PII: G2 for delivered output; G1 already covers actions.
# ---------------------------------------------------------------------------

_PII: tuple[EvalCaseSeed, ...] = (
    _case(
        "pii-delivered-output",
        [
            _llm("extract_patient_history"),
            _llm("summarize_for_doctor", ("extract_patient_history",)),
        ],
        {
            "outcome": "ready",
            "topology": "sequential",
            "gates": [_after("verification", "summarize_for_doctor")],
        },
        constraints={"contains_pii": True},
    ),
    _case(
        "pii-leaves-through-action",
        [_llm("compile_payroll"), _tool("upload_payroll", ("compile_payroll",), "sftp_upload")],
        {"outcome": "ready", "gates": [_before("verification", "upload_payroll")]},
        constraints={"contains_pii": True},
    ),
    _case(
        "pii-and-customer-visible",
        # Both constraints ask for the same verification gate: one gate.
        [_llm("draft_account_update")],
        {
            "outcome": "ready",
            "topology": "single",
            "gates": [
                _after("verification", "draft_account_update"),
                _after("human_approval", "draft_account_update"),
            ],
        },
        constraints={"contains_pii": True, "customer_visible": True},
    ),
    _case(
        "pii-absent-no-gate",
        # Control for pii-delivered-output: same skeleton, flag unset.
        [
            _llm("extract_patient_history"),
            _llm("summarize_for_doctor", ("extract_patient_history",)),
        ],
        {"outcome": "ready", "gates": []},
    ),
)

# ---------------------------------------------------------------------------
# E. Residency: eligibility against ARCHITECTURE_REGISTRY_FIXTURE.
# ---------------------------------------------------------------------------

_RESIDENCY: tuple[EvalCaseSeed, ...] = (
    _case(
        "residency-in-region-ready",
        [_llm("summarize_contracts")],
        {"outcome": "ready", "topology": "single"},
        constraints={"allowed_data_residency": ["eu"]},
        capabilities={"summarize_contracts": ["arch_eval.summarize_eu_only"]},
    ),
    _case(
        "residency-out-of-region-blocked",
        [_llm("draft_notice"), _tool("email_customers", ("draft_notice",), "email_send")],
        {"outcome": "blocked", "blocked_node": "email_customers"},
        constraints={"allowed_data_residency": ["eu"]},
        capabilities={"email_customers": ["arch_eval.email_us_only"]},
    ),
    _case(
        "residency-unconstrained-tenant-ready",
        [_llm("summarize_contracts")],
        {"outcome": "ready", "topology": "single"},
        capabilities={"summarize_contracts": ["arch_eval.summarize_eu_only"]},
    ),
    _case(
        "residency-unrestricted-capability-ready",
        [_llm("translate_faq")],
        {"outcome": "ready", "topology": "single"},
        constraints={"allowed_data_residency": ["eu"]},
        capabilities={"translate_faq": ["arch_eval.translate_unrestricted"]},
    ),
)

ARCHITECTURE_CASES: tuple[EvalCaseSeed, ...] = (
    *_SHAPE,
    *_EXTERNAL_ACTIONS,
    *_CONSTRAINT_GATES,
    *_PII,
    *_RESIDENCY,
)

ARCHITECTURE_GOLDEN_SET = GoldenSetSeed(
    _id("golden-set/architecture/v1"), "architecture", "architecture", 1, ARCHITECTURE_CASES
)
