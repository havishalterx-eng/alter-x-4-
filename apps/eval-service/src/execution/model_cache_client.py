"""Real client for tenant-isolation's model_gateway_cache case.

Targets apps/model-gateway/src/eval_bootstrap.ts, the same real,
disclosed eval-only entrypoint HARD-7d/e already use -- real
AnthropicModelProvider/OpenAiModelProvider built from a plain env var
API key (needs a real, live ANTHROPIC_API_KEY/OPENAI_API_KEY; without
one, this domain real-fails for a real reason, same disclosed gap as
'intent'/'injection').

The real, tenant-scoped semantic cache (ModelGatewayService.#lookupCache
BestEffort/#storeCacheBestEffort in model-gateway.service.ts) is keyed on
{tenantId, embedding} -- tenant-b's identical request must never hit
tenant-a's cached response. The real observable signal is the
`cache_hit` field on InvokeResponse (added to the real proto for this
case -- previously InvokeResponse had no way to distinguish a cached
response from a live model call at all).
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from alter.modelgw.v1 import modelgw_pb2, modelgw_pb2_grpc

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class ModelCacheInvokeResult:
    cache_hit: bool


class ModelGatewayCacheClient:
    def __init__(self, target: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._channel = grpc.insecure_channel(target)
        self._stub = modelgw_pb2_grpc.ModelgwServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds

    def invoke(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        model_alias: str,
        input_json: str,
    ) -> ModelCacheInvokeResult:
        response = self._stub.Invoke(
            modelgw_pb2.InvokeRequest(
                tenant_id=tenant_id,
                run_id=run_id,
                node_execution_id=node_execution_id,
                model_alias=model_alias,
                input_json=input_json,
            ),
            timeout=self._timeout_seconds,
        )
        return ModelCacheInvokeResult(cache_hit=bool(response.cache_hit))

    def close(self) -> None:
        self._channel.close()
