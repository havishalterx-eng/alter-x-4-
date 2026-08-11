from __future__ import annotations

import json
from typing import Protocol

import grpc
from pydantic import ValidationError

from alter.modelgw.v1 import modelgw_pb2, modelgw_pb2_grpc

from .m2m_auth import AccessTokenProvider
from .models import HallucinationAssessment, SafetyAssessment


class ModelGatewayInvocationError(RuntimeError):
    pass


class ModelGatewayClient(Protocol):
    async def classify_hallucination(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        task_context: dict[str, object],
        response: object,
        evidence: dict[str, object],
    ) -> HallucinationAssessment: ...

    async def assess_severity(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        finding: object,
    ) -> SafetyAssessment: ...


class GrpcModelGatewayClient:
    """Thin Python caller over the already-locked alter.modelgw.v1 contract."""

    def __init__(
        self,
        target: str,
        *,
        timeout_seconds: float = 15,
        channel: grpc.aio.Channel | None = None,
        access_token_provider: AccessTokenProvider | None = None,
    ) -> None:
        self._channel = channel or grpc.aio.insecure_channel(target)
        self._owns_channel = channel is None
        self._stub = modelgw_pb2_grpc.ModelgwServiceStub(  # type: ignore[no-untyped-call]
            self._channel
        )
        self._timeout_seconds = timeout_seconds
        self._access_token_provider = access_token_provider

    async def close(self) -> None:
        if self._owns_channel:
            await self._channel.close()

    async def classify_hallucination(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        task_context: dict[str, object],
        response: object,
        evidence: dict[str, object],
    ) -> HallucinationAssessment:
        content = await self._invoke_fast(
            tenant_id=tenant_id,
            run_id=run_id,
            node_execution_id=node_execution_id,
            instruction=(
                "Classify hallucination risk. Return ONLY JSON with keys "
                "hallucination_score (0..1), verdict (pass|fail), flagged_spans "
                "([{text,reason}]), reasons (string[]). A failed evidence check must fail."
            ),
            subject={
                "task_context": task_context,
                "response": response,
                "evidence": evidence,
            },
        )
        try:
            return HallucinationAssessment.model_validate_json(content)
        except ValidationError as error:
            raise ModelGatewayInvocationError("FAST classifier returned invalid output") from error

    async def assess_severity(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        finding: object,
    ) -> SafetyAssessment:
        content = await self._invoke_fast(
            tenant_id=tenant_id,
            run_id=run_id,
            node_execution_id=node_execution_id,
            instruction=(
                "Assess safety severity. Return ONLY JSON with keys severity "
                "(low|medium|high|critical) and rationale. Critical means terminate; "
                "all other tiers mean heal."
            ),
            subject={"finding": finding},
        )
        try:
            return SafetyAssessment.model_validate_json(content)
        except ValidationError as error:
            raise ModelGatewayInvocationError(
                "FAST severity assessor returned invalid output"
            ) from error

    async def _invoke_fast(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        instruction: str,
        subject: object,
    ) -> str:
        payload = json.dumps(
            {
                "messages": [
                    {"role": "system", "content": instruction},
                    {"role": "user", "content": json.dumps(subject, separators=(",", ":"))},
                ],
                "temperature": 0,
                "max_tokens": 1024,
            },
            separators=(",", ":"),
        )
        try:
            kwargs: dict[str, object] = {"timeout": self._timeout_seconds}
            if self._access_token_provider is not None:
                kwargs["metadata"] = self._access_token_provider.metadata()
            response = await self._stub.Invoke(
                modelgw_pb2.InvokeRequest(
                    tenant_id=tenant_id,
                    run_id=run_id,
                    node_execution_id=node_execution_id,
                    model_alias="FAST",
                    input_json=payload,
                ),
                **kwargs,
            )
        except Exception as error:
            raise ModelGatewayInvocationError("FAST classifier call failed") from error
        try:
            envelope = json.loads(response.output_json)
            content = envelope["message"]["content"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise ModelGatewayInvocationError(
                "FAST classifier response envelope is invalid"
            ) from error
        if not isinstance(content, str) or not content:
            raise ModelGatewayInvocationError("FAST classifier response content is empty")
        return content
