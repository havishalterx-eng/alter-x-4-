"""Real eval-run orchestration (HARD-7).

Every golden set built by HARD-1..6 is real seeded data with a real
scoring contract, but nothing before this ticket ever executed a case
against the real system and persisted a real eval_runs/eval_results row --
confirmed by reading every prior Hardening PR (launch_golden_sets.py's own
docstring: "data for a future runner, not an evaluation implementation").

HARD-7a wired 'verification' for real, via a real gRPC call to
verification-service's ScoreNodeInline. HARD-7b adds 'planner' for its
select_strategy operation only, via a real HTTP call to intelligence-
service's PlannerService.SelectStrategy route (that kernel is pure --
no ADS/LLM I/O). HARD-7c adds 'retrieval', via a real gRPC call to
ads-core's AdsqService.Retrieve, against a real seeded corpus (see
apps/ads-core/src/query/eval_grpc_server.py) -- real hybrid retrieval, a
disclosed non-production embedding technique (no live embedding provider
reachable here). HARD-7e adds 'intent', via a real gRPC call to
orchestration-service's ConversationService.ClassifyIntent (see
apps/orchestration-service/src/eval_intent_grpc_server.ts) -- this one
depends on a real, live model-gateway (HARD-7d's eval_bootstrap.ts) with a
real ANTHROPIC_API_KEY/OPENAI_API_KEY; without one, this domain's calls
fail for a real reason (no live credentials), not a harness bug. HARD-7f
adds 'injection', which spans three genuinely different real mechanisms
per suite (see security_client.py's own module doc): 'injection'/
'jailbreak' -> the same real, live LLM path as intent (via
eval_security_http_server.ts's PromptInjectionClassifier wiring);
'ssrf' -> pure, deterministic IP-blocklist logic, no LLM needed; 'upload'
-> ads-core's real, existing production presign route, not eval-only
scaffolding.
HARD-7g adds 'tenant-isolation' for 2 of its real 20 cases (this domain
is far more fragmented than the others -- 20 cases, ~12 different real
services, each its own isolation mechanism; most are disclosed follow-up,
not built here): 'ads_retrieve' (real Postgres RLS -- a query for
tenant-b's uniquely-worded probe document, issued under tenant-a's own
valid scope, must never return that document; ads-core's real Retrieve
RPC always returns top_k candidates rather than a literally empty list,
so "empty_result" here means "the tenant-b probe never appears", the
real security property under test, not a literal array-length check) and
'tool_resolve_credential' (real, pure ownership check in tool-gateway's
production ResolveCredential -- no eval-only entrypoint needed, the
cross-tenant case throws before ever touching a real secrets provider).
HARD-7h adds 'project' (project-E2E, 3/3 real cases): a real call to
intelligence-service's PlannerService.Decompose with
strategy=plan_then_execute, reusing HARD-7b's exact same real HTTP
server unchanged. build_project_skeleton() is pure and deterministic
(fixed 14-stage pipeline, see project_strategy.py's own module doc) --
the real GrpcAdsClient.retrieve() call decompose() always makes first
degrades to empty hits either way here (empty scope_ids always trips
ads-core's real ScopeViolationError, and GrpcAdsClient's own disclosed
fail-open catches exactly that), so no ADS backend is even needed for
this specific real path.
planner's decompose/replan operations for the 'planner' domain's
non-project strategies still need real ADS+LLM wiring, deliberately left
real-failing (never silently skipped) -- same disclosed-gap pattern as
the remaining domains (most of tenant-isolation), each its own follow-up.
HARD-7i adds 'recovery' for 5 of its 15 real cases: the ones whose real
dispatch (RecoveryDispatchService.dispatch()) never touches Temporal, a
live LLM, or Planner -- "ask_user" (real DB-backed approvals row) and
"swap_agent" (a real, disclosed "no target system wired yet" deferred
outcome). See apps/orchestration-service/src/eval_recovery_grpc_server.ts
and recovery_client.py's own module docs: the real recovery_actions row
SelectStrategy needs is seeded directly via SQL (bypassing
ClassifyFailure's real, live ADVANCED-tier Model Gateway call), same
shortcut shape as ads-core's document seeding. The other 10 cases
(retry/backoff need a real Temporal signal, escalate_model needs a real
live LLM, replan/recompile need a real Planner call, 3 policy-override
cases need none of those but aren't dispatch-light either) are disclosed
follow-up, not built here.
HARD-7j adds 'workflow' (workflow-E2E) for 1 of its 5 real cases:
'register_trigger', via the real, unmodified TriggerRegistryController +
TriggerRegistryService (see eval_trigger_registry_http_server.ts's own
module doc -- production's real SessionGatewayGuard needs live JWT
signing keys not reachable here, so a synthetic ActorContext is injected
in its place; the real registerTrigger business logic itself is
untouched). workflowVersionId has no real FK to any workflow_versions
row (a real, disclosed gap in trigger-registry.service.ts itself, not
introduced here) -- only a real `workflows` row is needed.
'create_save_workflow'/'simulate_workflow' are a real, structural dead
end, not a "needs more infra" gap: platform-api's WorkflowService calls
POST /api/v1/workflows and .../actions/simulate on orchestration-service,
but orchestration-service serves neither route anywhere -- a genuine
missing production feature, flagged as its own separate follow-up
ticket, not an eval-wiring problem. 'clarify_then_replan'/'run_gate' were
deliberately not investigated further (real classes exist for both, but
chasing every remaining operation's exact real backend has hit
diminishing returns after 7f/7g/7i's fragmentation).
See EvalRunOrchestrator.run()'s domain check and _score_case's operation
dispatch.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from src.db.models import EvalCase, EvalResult, EvalRun, GoldenSet

from .intent_client import IntentClient
from .planner_client import PlannerClient
from .recovery_client import RecoveryClient
from .retrieval_client import RetrievalClient
from .security_client import SecurityEvalClient, UploadEvalClient
from .toolgw_client import ToolgwClient
from .trigger_client import TriggerRegistryClient
from .verification_client import VerificationClient

# Real, fixed synthetic identity for every case this orchestrator scores --
# ScoreNodeInline's kernel is pure (no DB lookup against these IDs, see
# verification-service's ScoreNodeRequest field validators: shape-checked
# only). Real, well-formed prefixed UUIDv7s, never referencing any actual
# tenant/run/node_execution row, and never claiming to.
_EVAL_TENANT_ID = "ten_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"
_EVAL_RUN_ID = "run_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"
_EVAL_WORKSPACE_ID = "ws_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"

# Real, fixed synthetic identity for the retrieval domain -- must match the
# tenant/workspace/scope apps/ads-core/src/query/eval_grpc_server.py seeds
# its corpus under (see its EVAL_ADS_TENANT_ID/WORKSPACE_ID/SCOPE_ID env
# vars). ScopeViolationError is real and enforced (validate_scopes queries
# a real scopes row), so this must be an exact, agreed-upon value, not just
# a well-formed one.
_EVAL_ADS_TENANT_ID = "ten_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"
_EVAL_ADS_WORKSPACE_ID = "ws_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"
_EVAL_ADS_SCOPE_ID = "scp_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee"

# Tenant-b probe document key -- must match
# apps/ads-core/src/query/eval_grpc_server.py's own _TENANT_B_UNIQUE_DOCUMENT.
_TENANT_B_PROBE_DOCUMENT_ID = "doc_tenant_b_isolation_probe"

# Real, fixed synthetic tenant for the recovery domain -- bare UUID (no
# ten_ prefix), matching recovery_actions.tenant_id's real uuid column type.
_EVAL_RECOVERY_TENANT_UUID = "018f4d6e-dddd-7ddd-8ddd-dddddddddddd"

# Real dispatch strategies (RecoveryDispatchService.dispatch()) whose
# real path never touches Temporal, a live LLM, or Planner -- see
# eval_recovery_grpc_server.ts's own module doc.
_RECOVERY_DISPATCH_LIGHT_STRATEGIES = frozenset({"ask_user", "swap_agent"})

# Real, fixed synthetic tenant for the workflow domain -- bare UUID (no
# ten_ prefix), matching workflows.tenant_id's real uuid column type.
_EVAL_WORKFLOW_TENANT_UUID = "018f4d6e-ffff-7fff-8fff-ffffffffffff"

SUPPORTED_DOMAINS = frozenset(
    {
        "verification",
        "planner",
        "retrieval",
        "intent",
        "injection",
        "tenant-isolation",
        "project",
        "recovery",
        "workflow",
    }
)

_SUBJECT_BY_DOMAIN = {
    "verification": "verification-service",
    "planner": "intelligence-service",
    "retrieval": "ads-core",
    "intent": "orchestration-service",
    "injection": "orchestration-service",
    "tenant-isolation": "multi-service",
    "project": "intelligence-service",
    "recovery": "orchestration-service",
    "workflow": "orchestration-service",
}


class UnsupportedDomainError(ValueError):
    pass


class GoldenSetNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class EvalRunSummary:
    eval_run_id: UUID
    golden_set_name: str
    total_cases: int
    passed: int
    failed: int
    pass_rate: float


class EvalRunOrchestrator:
    def __init__(
        self,
        sessions: sessionmaker[Session],
        verification_client: VerificationClient,
        planner_client: PlannerClient,
        retrieval_client: RetrievalClient,
        intent_client: IntentClient,
        security_client: SecurityEvalClient,
        upload_client: UploadEvalClient,
        tenant_isolation_retrieval_client: RetrievalClient,
        toolgw_client: ToolgwClient,
        recovery_client: RecoveryClient,
        trigger_registry_client: TriggerRegistryClient,
    ) -> None:
        self._sessions = sessions
        self._verification_client = verification_client
        self._planner_client = planner_client
        self._retrieval_client = retrieval_client
        self._intent_client = intent_client
        self._security_client = security_client
        self._upload_client = upload_client
        self._tenant_isolation_retrieval_client = tenant_isolation_retrieval_client
        self._toolgw_client = toolgw_client
        self._recovery_client = recovery_client
        self._trigger_registry_client = trigger_registry_client

    def run(self, golden_set_name: str, trigger: str = "manual") -> EvalRunSummary:
        with self._sessions.begin() as session:
            golden_set = session.scalar(
                select(GoldenSet)
                .where(GoldenSet.name == golden_set_name, GoldenSet.status == "active")
                .order_by(GoldenSet.version.desc())
            )
            if golden_set is None:
                raise GoldenSetNotFoundError(
                    f"No active golden set named {golden_set_name!r}"
                )
            if golden_set.domain not in SUPPORTED_DOMAINS:
                raise UnsupportedDomainError(
                    f"Domain {golden_set.domain!r} has no real execution wired yet "
                    f"(only {sorted(SUPPORTED_DOMAINS)} are real as of HARD-7). "
                    "Real, disclosed follow-up scope -- not silently skipped."
                )
            cases = list(
                session.scalars(select(EvalCase).where(EvalCase.golden_set_id == golden_set.id))
            )

            domain = golden_set.domain
            eval_run = EvalRun(
                id=uuid4(),
                golden_set_id=golden_set.id,
                golden_set_version=golden_set.version,
                subject=_SUBJECT_BY_DOMAIN[domain],
                trigger=trigger,
                status="running",
                started_at=datetime.now(UTC),
            )
            session.add(eval_run)
            session.flush()
            eval_run_id = eval_run.id

        passed = 0
        failed = 0
        for case in cases:
            verdict = self._score_case(domain, case)
            with self._sessions.begin() as session:
                session.add(
                    EvalResult(
                        id=_result_id(eval_run_id, case.id),
                        eval_run_id=eval_run_id,
                        eval_case_id=case.id,
                        verdict=verdict.verdict,
                        score=verdict.score,
                        output_ref=None,
                        details=verdict.details,
                    )
                )
            if verdict.verdict == "pass":
                passed += 1
            else:
                failed += 1

        total = len(cases)
        pass_rate = passed / total if total > 0 else 0.0
        with self._sessions.begin() as session:
            run = session.get(EvalRun, eval_run_id)
            assert run is not None  # just inserted in this same method, real invariant
            run.status = "completed"
            run.pass_rate = pass_rate
            run.completed_at = datetime.now(UTC)

        return EvalRunSummary(
            eval_run_id=eval_run_id,
            golden_set_name=golden_set_name,
            total_cases=total,
            passed=passed,
            failed=failed,
            pass_rate=pass_rate,
        )

    def _score_case(self, domain: str, case: EvalCase) -> _CaseVerdict:
        if domain == "planner":
            return self._score_planner_case(case)
        if domain == "retrieval":
            return self._score_retrieval_case(case)
        if domain == "intent":
            return self._score_intent_case(case)
        if domain == "injection":
            return self._score_injection_case(case)
        if domain == "tenant-isolation":
            return self._score_tenant_isolation_case(case)
        if domain == "project":
            return self._score_project_case(case)
        if domain == "recovery":
            return self._score_recovery_case(case)
        if domain == "workflow":
            return self._score_workflow_case(case)
        return self._score_verification_case(case)

    def _score_verification_case(self, case: EvalCase) -> _CaseVerdict:
        operation = case.input_json.get("operation")
        if operation != "score_node":
            # Real, honest fail-closed: a case this orchestrator doesn't
            # know how to execute is scored fail, never silently skipped
            # and never silently counted as pass.
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported operation {operation!r} for domain=verification"
                },
            )

        node_type = str(case.input_json["node_type"])
        config_json = str(case.input_json["config_json"])
        output_json = str(case.input_json["output_json"])
        node_key = f"eval_{node_type.lower()}"

        try:
            result = self._verification_client.score_node_inline(
                tenant_id=_EVAL_TENANT_ID,
                run_id=_EVAL_RUN_ID,
                node_execution_id=_node_execution_id(case.id),
                node_key=node_key,
                node_type=node_type,
                config_json=config_json,
                output_json=output_json,
            )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"ScoreNodeInline call failed: {error}"},
            )

        # eval_results.verdict CHECK only allows ('pass', 'fail') -- the
        # real kernel can also return 'warn' (score-banding, kernel.py's
        # WARN_MARGIN). None of this golden set's 20 seeded cases exercise
        # that band, but the mapping must still be safe if one ever does:
        # 'warn' counts as a real fail here, never silently upgraded to a
        # pass. Disclosed design decision, not an oversight.
        observed = {"verdict": result.verdict, "threshold": result.threshold}
        expected = case.expected_json
        exact_match = observed == expected
        # real_verdict reflects whether THIS CASE passed (real system
        # behavior matched the golden-set expectation) -- not whether the
        # underlying node output itself verdicted "pass". A case expecting
        # "fail" that genuinely got "fail" back is a passing eval case.
        if result.verdict == "warn":
            real_verdict = "fail"
        else:
            real_verdict = "pass" if exact_match else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=result.score,
            details={
                "observed": observed,
                "expected": expected,
                "reviewer_model": result.reviewer_model,
                "kernel_details": _safe_json(result.details_json),
            },
        )

    def _score_retrieval_case(self, case: EvalCase) -> _CaseVerdict:
        operation = case.input_json.get("operation")
        if operation != "retrieve":
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported operation {operation!r} for domain=retrieval "
                    "(only retrieve is real as of HARD-7c)"
                },
            )

        query = str(case.input_json["query"])
        rank_at_most_raw = case.scoring.get("rank_at_most", 10)
        rank_at_most = int(rank_at_most_raw) if isinstance(rank_at_most_raw, int | float) else 10

        try:
            result = self._retrieval_client.retrieve(
                tenant_id=_EVAL_ADS_TENANT_ID,
                workspace_id=_EVAL_ADS_WORKSPACE_ID,
                query=query,
                scope_ids=(_EVAL_ADS_SCOPE_ID,),
                top_k=rank_at_most,
                requester="eval-service",
            )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"Retrieve call failed: {error}"},
            )

        expected_document_key = str(case.expected_json["expected_document_key"])
        hit_rank = (
            result.document_ids.index(expected_document_key)
            if expected_document_key in result.document_ids
            else None
        )
        real_verdict = "pass" if hit_rank is not None else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=1.0 if real_verdict == "pass" else 0.0,
            details={
                "expected_document_key": expected_document_key,
                "hit_rank": hit_rank,
                "observed_document_ids": list(result.document_ids),
            },
        )

    def _score_intent_case(self, case: EvalCase) -> _CaseVerdict:
        operation = case.input_json.get("operation")
        if operation != "classify_intent":
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported operation {operation!r} for domain=intent "
                    "(only classify_intent is real as of HARD-7e)"
                },
            )

        utterance = str(case.input_json["utterance"])

        try:
            result = self._intent_client.classify_intent(
                tenant_id=_EVAL_TENANT_ID,
                workspace_id=_EVAL_WORKSPACE_ID,
                conversation_id=_intent_conversation_id(case.id),
                utterance=utterance,
            )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"ClassifyIntent call failed: {error}"},
            )

        observed = {"intent": result.intent, "actionable": result.actionable}
        expected = case.expected_json
        real_verdict = "pass" if observed == expected else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=result.confidence,
            details={"observed": observed, "expected": expected, "confidence": result.confidence},
        )

    def _score_tenant_isolation_case(self, case: EvalCase) -> _CaseVerdict:
        operation = str(case.input_json["operation"])
        expected = case.expected_json

        try:
            if operation == "ads_retrieve":
                result = self._tenant_isolation_retrieval_client.retrieve(
                    tenant_id=_EVAL_ADS_TENANT_ID,
                    workspace_id=_EVAL_ADS_WORKSPACE_ID,
                    query="zynqvortal proprietary rollout schedule",
                    scope_ids=(_EVAL_ADS_SCOPE_ID,),
                    top_k=10,
                    requester="eval-service",
                )
                probe_leaked = _TENANT_B_PROBE_DOCUMENT_ID in result.document_ids
                observed_outcome = "empty_result" if not probe_leaked else "leaked"
                extra: dict[str, object] = {"document_ids": list(result.document_ids)}
            elif operation == "tool_resolve_credential":
                credential_ref = (
                    "/alter/prod/tenant/ten_018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb/"
                    "integration/itg_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee/secret"
                )
                outcome = self._toolgw_client.resolve_credential(
                    tenant_id=_EVAL_TENANT_ID,
                    integration_id="itg_018f4d6e-eeee-7eee-8eee-eeeeeeeeeeee",
                    credential_ref=credential_ref,
                )
                observed_outcome = "denied" if outcome.denied else "allowed"
                extra = {"error_message": outcome.error_message}
            else:
                return _CaseVerdict(
                    verdict="fail",
                    score=0.0,
                    details={
                        "error": f"unsupported operation {operation!r} for domain=tenant-isolation "
                        "(only ads_retrieve and tool_resolve_credential are real as of HARD-7g; "
                        "the other 18 of 20 real tenant-isolation cases are disclosed follow-up "
                        "scope, see orchestrator.py's own module doc)"
                    },
                )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"tenant-isolation call failed for {operation!r}: {error}"},
            )

        observed = {"outcome": observed_outcome}
        real_verdict = "pass" if observed == expected else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=1.0 if real_verdict == "pass" else 0.0,
            details={"observed": observed, "expected": expected, "operation": operation, **extra},
        )

    def _score_injection_case(self, case: EvalCase) -> _CaseVerdict:
        operation = case.input_json.get("operation")
        if operation != "security_classify":
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported operation {operation!r} for domain=injection "
                    "(only security_classify is real as of HARD-7f)"
                },
            )

        suite = str(case.input_json["suite"])
        text = str(case.input_json["text"])
        expected = case.expected_json

        try:
            if suite in ("injection", "jailbreak"):
                result = self._security_client.classify_injection(
                    tenant_id=_EVAL_TENANT_ID,
                    run_id=_EVAL_RUN_ID,
                    node_execution_id=_node_execution_id(case.id),
                    text=text,
                )
                observed_outcome = "blocked" if result.blocked else "allowed"
                extra: dict[str, object] = {
                    "confidence": result.confidence,
                    "reason": result.reason,
                }
            elif suite == "ssrf":
                url = text.removeprefix("fetch ").strip()
                ssrf_result = self._security_client.check_ssrf(url=url)
                observed_outcome = "blocked" if ssrf_result.blocked else "allowed"
                extra = {"reason": ssrf_result.reason}
            elif suite == "upload":
                content_type = text.split()[-1]
                upload_result = self._upload_client.check_upload(
                    tenant_id=_EVAL_TENANT_ID,
                    source_id=_upload_source_id(case.id),
                    content_type=content_type,
                )
                observed_outcome = "blocked" if upload_result.blocked else "allowed"
                extra = {"detail": upload_result.detail}
            else:
                return _CaseVerdict(
                    verdict="fail",
                    score=0.0,
                    details={"error": f"unsupported suite {suite!r} for domain=injection"},
                )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"security_classify call failed for suite {suite!r}: {error}"},
            )

        observed = {"outcome": observed_outcome}
        real_verdict = "pass" if observed == expected else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=1.0 if real_verdict == "pass" else 0.0,
            details={"observed": observed, "expected": expected, "suite": suite, **extra},
        )

    def _score_workflow_case(self, case: EvalCase) -> _CaseVerdict:
        operation = case.input_json.get("operation")
        if operation != "register_trigger":
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported operation {operation!r} for domain=workflow "
                    "(only register_trigger is real as of HARD-7j -- create_save_workflow/"
                    "simulate_workflow have no real serving backend on either side yet, "
                    "clarify_then_replan/run_gate deliberately not investigated further, "
                    "see orchestrator.py's own module doc)"
                },
            )

        try:
            result = self._trigger_registry_client.register_trigger(
                tenant_uuid=_EVAL_WORKFLOW_TENANT_UUID,
                workflow_id=f"wf_eval_{case.id}",
                name="eval harness trigger",
            )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"RegisterTrigger call failed: {error}"},
            )

        observed = {"bound_to_version": result.bound_to_version}
        expected = case.expected_json
        real_verdict = "pass" if observed == expected else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=1.0 if real_verdict == "pass" else 0.0,
            details={"observed": observed, "expected": expected},
        )

    def _score_recovery_case(self, case: EvalCase) -> _CaseVerdict:
        operation = case.input_json.get("operation")
        if operation != "select_recovery_strategy":
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported operation {operation!r} for domain=recovery "
                    "(only select_recovery_strategy is real as of HARD-7i)"
                },
            )

        expected = case.expected_json
        expected_strategy = str(expected.get("strategy", ""))
        if expected_strategy not in _RECOVERY_DISPATCH_LIGHT_STRATEGIES:
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported dispatch strategy {expected_strategy!r} for "
                    "domain=recovery (only ask_user/swap_agent are real as of HARD-7i -- "
                    "retry/backoff need a real Temporal signal, escalate_model needs a "
                    "real live LLM, replan/recompile need a real Planner call)"
                },
            )

        failure_class = str(case.input_json["failure_class"])
        node_attempt_raw = case.input_json.get("node_attempt", 1)
        node_attempt = int(node_attempt_raw) if isinstance(node_attempt_raw, int | float) else 1

        run_id = _recovery_run_id(case.id)
        node_execution_id = _recovery_node_execution_id(case.id)

        try:
            result = self._recovery_client.select_strategy(
                tenant_id=f"ten_{_EVAL_RECOVERY_TENANT_UUID}",
                tenant_uuid=_EVAL_RECOVERY_TENANT_UUID,
                run_id=run_id,
                node_execution_id=node_execution_id,
                failure_class=failure_class,
                node_attempt=node_attempt,
            )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"SelectStrategy call failed: {error}"},
            )

        observed = {"strategy": result.strategy}
        real_verdict = "pass" if observed == expected else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=1.0 if real_verdict == "pass" else 0.0,
            details={
                "observed": observed,
                "expected": expected,
                "recovery_action_id": result.recovery_action_id,
            },
        )

    def _score_project_case(self, case: EvalCase) -> _CaseVerdict:
        operation = case.input_json.get("operation")
        if operation != "build_project_skeleton":
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported operation {operation!r} for domain=project "
                    "(only build_project_skeleton is real as of HARD-7h)"
                },
            )

        objective = str(case.input_json["objective"])

        try:
            result = self._planner_client.decompose(
                tenant_id=_EVAL_TENANT_ID,
                workspace_id=_EVAL_WORKSPACE_ID,
                run_id=_EVAL_RUN_ID,
                objective=objective,
                strategy="plan_then_execute",
            )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"Decompose call failed: {error}"},
            )

        observed = {
            "stage_count": result.stage_count,
            "entry_point": result.entry_point,
            "stages": result.stages,
        }
        expected = case.expected_json
        real_verdict = "pass" if observed == expected else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=1.0 if real_verdict == "pass" else 0.0,
            details={
                "observed": observed,
                "expected": expected,
                "ambiguity_detected": result.ambiguity_detected,
            },
        )

    def _score_planner_case(self, case: EvalCase) -> _CaseVerdict:
        operation = case.input_json.get("operation")
        if operation != "select_strategy":
            # decompose/replan need real ADS+LLM wiring -- disclosed
            # follow-up scope (see module doc), same fail-closed pattern
            # as an unsupported domain: never silently skipped.
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={
                    "error": f"unsupported operation {operation!r} for domain=planner "
                    "(only select_strategy is real as of HARD-7b)"
                },
            )

        objective = str(case.input_json["objective"])
        mode = str(case.input_json["mode"])

        try:
            result = self._planner_client.select_strategy(
                tenant_id=_EVAL_TENANT_ID, objective=objective, mode=mode
            )
        except Exception as error:  # noqa: BLE001 -- real per-case isolation, see module doc
            return _CaseVerdict(
                verdict="fail",
                score=0.0,
                details={"error": f"SelectStrategy call failed: {error}"},
            )

        observed = {"strategy": result.strategy}
        expected = case.expected_json
        real_verdict = "pass" if observed == expected else "fail"

        return _CaseVerdict(
            verdict=real_verdict,
            score=1.0 if real_verdict == "pass" else 0.0,
            details={"observed": observed, "expected": expected, "reason": result.reason},
        )


@dataclass(frozen=True)
class _CaseVerdict:
    verdict: str
    score: float
    details: dict[str, object]


def _result_id(eval_run_id: UUID, eval_case_id: UUID) -> UUID:
    return uuid5(NAMESPACE_URL, f"https://alterx.dev/eval/result/{eval_run_id}/{eval_case_id}")


def _intent_conversation_id(eval_case_id: UUID) -> str:
    conversation_uuid = uuid5(NAMESPACE_URL, f"https://alterx.dev/eval/conversation/{eval_case_id}")
    return f"cnv_{conversation_uuid}"


def _upload_source_id(eval_case_id: UUID) -> str:
    source_uuid = uuid5(NAMESPACE_URL, f"https://alterx.dev/eval/upload-source/{eval_case_id}")
    return f"src_{source_uuid}"


def _v7_shaped_uuid(namespace_path: str) -> UUID:
    # A prefixed-id schema (RunIdSchema/NodeExecutionIdSchema/...) requires
    # a UUIDv7-shaped id (version nibble '7', variant nibble one of
    # '89ab') -- uuid5 produces a version-5 UUID, which real pydantic/zod
    # validators reject outright. Deterministic from the given path, but
    # with the version/variant nibbles forced to a valid v7 shape.
    raw = uuid5(NAMESPACE_URL, namespace_path).hex
    shaped = f"{raw[0:12]}7{raw[13:16]}8{raw[17:32]}"
    return UUID(shaped)


def _node_execution_id(eval_case_id: UUID) -> str:
    node_uuid = _v7_shaped_uuid(f"https://alterx.dev/eval/node-execution/{eval_case_id}")
    return f"node_{node_uuid}"


def _recovery_run_id(eval_case_id: UUID) -> str:
    run_uuid = _v7_shaped_uuid(f"https://alterx.dev/eval/recovery-run/{eval_case_id}")
    return f"run_{run_uuid}"


def _recovery_node_execution_id(eval_case_id: UUID) -> str:
    node_uuid = _v7_shaped_uuid(f"https://alterx.dev/eval/recovery-node-execution/{eval_case_id}")
    return f"node_{node_uuid}"


def _safe_json(value: str) -> object:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {"raw": value}
