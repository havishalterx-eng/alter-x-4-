from __future__ import annotations

import json
import re
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from .errors import VerificationError, verification_problem
from .ids import new_prefixed_uuid7, raw_uuid7
from .model_gateway_client import ModelGatewayClient, ModelGatewayInvocationError
from .models import HallucinationAssessment, ProblemDetails, SafetyAssessment
from .repository import VerificationDataError, VerificationRepository

HALLUCINATION_THRESHOLD = 0.5
_NODE_REF = re.compile(r"^[A-Za-z][A-Za-z0-9._-]{0,127}$")


@dataclass(frozen=True)
class HallucinationResult:
    verification_result_id: str
    assessment: HallucinationAssessment


@dataclass(frozen=True)
class SeverityResult:
    verification_result_id: str
    assessment: SafetyAssessment


class HallucinationVerificationEngine:
    def __init__(self, session: AsyncSession, model_gateway: ModelGatewayClient) -> None:
        self._session = session
        self._repository = VerificationRepository(session)
        self._model_gateway = model_gateway

    async def check_hallucination(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        response_node_ref: str,
        evidence_node_refs: tuple[str, ...],
    ) -> HallucinationResult:
        tenant_uuid = _validate_request_ids(tenant_id, run_id, node_execution_id)
        _validate_node_ref(response_node_ref)
        for reference in evidence_node_refs:
            _validate_node_ref(reference)
        instance = f"/runs/{run_id}/verification/hallucination"

        try:
            async with self._session.begin():
                await self._repository.set_tenant(tenant_uuid)
                context = await self._repository.load_context(
                    tenant_uuid=tenant_uuid,
                    run_id=run_id,
                    node_execution_id=node_execution_id,
                    response_node_ref=response_node_ref,
                    evidence_node_refs=evidence_node_refs,
                )
        except VerificationDataError as error:
            raise VerificationError(
                verification_problem(
                    status=422,
                    title="Verification input unavailable",
                    detail=str(error),
                    error_code="VERIFICATION_INPUT_UNAVAILABLE",
                    retryable=False,
                    documentation_key="verification.input-unavailable",
                    instance=instance,
                )
            ) from error

        result_id = new_prefixed_uuid7("ver")
        try:
            assessment = await self._model_gateway.classify_hallucination(
                tenant_id=tenant_id,
                run_id=run_id,
                node_execution_id=node_execution_id,
                task_context=context.task_context,
                response=context.response,
                evidence=context.evidence,
            )
            expected = (
                "fail" if assessment.hallucination_score >= HALLUCINATION_THRESHOLD else "pass"
            )
            if assessment.verdict != expected:
                raise ModelGatewayInvocationError("classifier verdict conflicts with its score")
        except ModelGatewayInvocationError as error:
            problem = verification_problem(
                status=503,
                title="Hallucination verification failed",
                detail=(
                    "FAST hallucination verification did not complete; output is not verified clean"
                ),
                error_code="HALLUCINATION_VERIFICATION_FAILED",
                retryable=True,
                documentation_key="verification.classifier-failed",
                instance=instance,
            )
            await self._persist_failure(
                tenant_uuid=tenant_uuid,
                run_id=run_id,
                node_execution_id=node_execution_id,
                result_id=result_id,
                gate_type="hallucination",
                problem=problem,
            )
            raise VerificationError(problem) from error

        async with self._session.begin():
            await self._repository.set_tenant(tenant_uuid)
            await self._repository.insert_result(
                {
                    "id": result_id,
                    "tenant_id": tenant_uuid,
                    "run_id": run_id,
                    "node_execution_id": node_execution_id,
                    "gate_type": "hallucination",
                    "verdict": assessment.verdict,
                    "score": assessment.hallucination_score,
                    "threshold": HALLUCINATION_THRESHOLD,
                    "details": assessment.model_dump_json(),
                }
            )
        return HallucinationResult(result_id, assessment)

    async def assess_severity(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        finding_json: str,
    ) -> SeverityResult:
        tenant_uuid = _validate_request_ids(tenant_id, run_id, node_execution_id)
        instance = f"/runs/{run_id}/verification/severity"
        try:
            finding = json.loads(finding_json)
        except json.JSONDecodeError as error:
            raise VerificationError(
                verification_problem(
                    status=400,
                    title="Invalid safety finding",
                    detail="finding_json must be valid JSON",
                    error_code="INVALID_SAFETY_FINDING",
                    retryable=False,
                    documentation_key="verification.invalid-finding",
                    instance=instance,
                )
            ) from error

        try:
            async with self._session.begin():
                await self._repository.set_tenant(tenant_uuid)
                await self._repository.ensure_node(
                    tenant_uuid=tenant_uuid,
                    run_id=run_id,
                    node_execution_id=node_execution_id,
                )
        except VerificationDataError as error:
            raise VerificationError(
                verification_problem(
                    status=422,
                    title="Verification input unavailable",
                    detail=str(error),
                    error_code="VERIFICATION_INPUT_UNAVAILABLE",
                    retryable=False,
                    documentation_key="verification.input-unavailable",
                    instance=instance,
                )
            ) from error

        result_id = new_prefixed_uuid7("ver")
        try:
            assessment = await self._model_gateway.assess_severity(
                tenant_id=tenant_id,
                run_id=run_id,
                node_execution_id=node_execution_id,
                finding=finding,
            )
        except ModelGatewayInvocationError as error:
            problem = verification_problem(
                status=503,
                title="Safety assessment failed",
                detail="FAST safety assessment did not complete; recovery must fail closed",
                error_code="SAFETY_ASSESSMENT_FAILED",
                retryable=True,
                documentation_key="verification.severity-failed",
                instance=instance,
            )
            await self._persist_failure(
                tenant_uuid=tenant_uuid,
                run_id=run_id,
                node_execution_id=node_execution_id,
                result_id=result_id,
                gate_type="safety",
                problem=problem,
            )
            raise VerificationError(problem) from error

        verdict = "fail" if assessment.severity == "critical" else "warn"
        details = assessment.model_dump()
        details["recovery_signal"] = assessment.recovery_signal
        async with self._session.begin():
            await self._repository.set_tenant(tenant_uuid)
            await self._repository.insert_result(
                {
                    "id": result_id,
                    "tenant_id": tenant_uuid,
                    "run_id": run_id,
                    "node_execution_id": node_execution_id,
                    "gate_type": "safety",
                    "verdict": verdict,
                    "score": None,
                    "threshold": None,
                    "details": json.dumps(details, separators=(",", ":")),
                }
            )
        return SeverityResult(result_id, assessment)

    async def _persist_failure(
        self,
        *,
        tenant_uuid: str,
        run_id: str,
        node_execution_id: str,
        result_id: str,
        gate_type: str,
        problem: ProblemDetails,
    ) -> None:
        async with self._session.begin():
            await self._repository.set_tenant(tenant_uuid)
            await self._repository.insert_result(
                {
                    "id": result_id,
                    "tenant_id": tenant_uuid,
                    "run_id": run_id,
                    "node_execution_id": node_execution_id,
                    "gate_type": gate_type,
                    "verdict": "fail",
                    "score": None,
                    "threshold": None,
                    "details": json.dumps(
                        {"verification_status": "failed", "problem": problem.model_dump()},
                        separators=(",", ":"),
                    ),
                }
            )


def _validate_request_ids(tenant_id: str, run_id: str, node_execution_id: str) -> str:
    try:
        tenant_uuid = raw_uuid7(tenant_id, "ten")
        raw_uuid7(run_id, "run")
        raw_uuid7(node_execution_id, "node")
    except ValueError as error:
        raise VerificationError(
            verification_problem(
                status=400,
                title="Invalid verification request",
                detail=str(error),
                error_code="INVALID_VERIFICATION_REQUEST",
                retryable=False,
                documentation_key="verification.invalid-request",
                instance="/verification",
            )
        ) from error
    return tenant_uuid


def _validate_node_ref(reference: str) -> None:
    if _NODE_REF.fullmatch(reference) is None:
        raise VerificationError(
            verification_problem(
                status=400,
                title="Invalid node reference",
                detail="node reference must be a compiled DAG node key",
                error_code="INVALID_NODE_REFERENCE",
                retryable=False,
                documentation_key="verification.invalid-node-ref",
                instance="/verification",
            )
        )
