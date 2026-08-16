"""Model Gateway boundary for LLM-backed problem understanding."""

from __future__ import annotations

import json
from typing import Protocol, runtime_checkable

import grpc

from alter.modelgw.v1 import modelgw_pb2, modelgw_pb2_grpc

from ..m2m_auth import AccessTokenProvider
from .models import ProblemSpec

_MODEL_ALIAS = "STANDARD"
_SYSTEM_PROMPT = """Turn a user request and verified context into a ProblemSpec.
Return strict JSON only with keys: objective, current_situation, actors,
systems_involved, constraints, required_data, risk, missing_information,
success_criteria. Never invent facts missing from the context; record them in
missing_information. risk must be a non-empty concise classification."""


@runtime_checkable
class ProblemUnderstandingLlmClient(Protocol):
    async def generate_problem_spec(
        self,
        *,
        tenant_id: str,
        run_id: str,
        objective: str,
        actor_context: dict[str, str],
        kb_context: str,
    ) -> ProblemSpec: ...


class ModelGatewayProblemUnderstandingClient:
    """Real Model Gateway client; never calls a model provider directly."""

    def __init__(
        self,
        target: str,
        *,
        timeout_seconds: float = 30,
        channel: grpc.aio.Channel | None = None,
        access_token_provider: AccessTokenProvider | None = None,
    ) -> None:
        self._channel = channel or grpc.aio.insecure_channel(target)
        self._owns_channel = channel is None
        self._stub = modelgw_pb2_grpc.ModelgwServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds
        self._access_token_provider = access_token_provider

    async def close(self) -> None:
        if self._owns_channel:
            await self._channel.close()

    async def generate_problem_spec(
        self,
        *,
        tenant_id: str,
        run_id: str,
        objective: str,
        actor_context: dict[str, str],
        kb_context: str,
    ) -> ProblemSpec:
        payload = json.dumps(
            {
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "objective": objective,
                                "actor_context": actor_context,
                                "verified_ads_context": kb_context,
                            },
                            separators=(",", ":"),
                        ),
                    },
                ],
                "temperature": 0.1,
            },
            separators=(",", ":"),
        )
        kwargs: dict[str, object] = {"timeout": self._timeout_seconds}
        if self._access_token_provider is not None:
            kwargs["metadata"] = self._access_token_provider.metadata()
        response = await self._stub.Invoke(
            modelgw_pb2.InvokeRequest(
                tenant_id=tenant_id,
                run_id=run_id,
                node_execution_id=f"problem_understanding_{run_id}",
                model_alias=_MODEL_ALIAS,
                input_json=payload,
            ),
            **kwargs,
        )
        try:
            envelope = json.loads(response.output_json)
            return ProblemSpec.model_validate_json(envelope["message"]["content"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ProblemUnderstandingLlmError(
                "Model Gateway returned an invalid ProblemSpec"
            ) from exc


class ProblemUnderstandingLlmError(RuntimeError):
    """The real Model Gateway response cannot produce a valid ProblemSpec."""
