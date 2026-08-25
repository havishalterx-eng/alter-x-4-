"""Real gRPC client to ads-core's AdsqService (HARD-7c).

alter.adsq.v1 is already generated under alter/ for the other domains'
proto packages -- this adds the adsq subpackage the same way (see
apps/eval-service/scripts/generate_protos.py).
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from alter.adsq.v1 import adsq_pb2, adsq_pb2_grpc

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class RetrieveResult:
    document_ids: tuple[str, ...]


class RetrievalClient:
    def __init__(
        self,
        target: str,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        *,
        service_token: str = "",
    ) -> None:
        self._channel = grpc.insecure_channel(target)
        self._stub = adsq_pb2_grpc.AdsqServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds
        # Same optional-credential convention as IngestionEvalClient: attach
        # the internal service credential when one is configured so the
        # callee's gRPC interceptor accepts the call.
        self._metadata = (("authorization", f"Bearer {service_token}"),) if service_token else None

    def retrieve(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        query: str,
        scope_ids: tuple[str, ...],
        top_k: int,
        requester: str,
    ) -> RetrieveResult:
        response = self._stub.Retrieve(
            adsq_pb2.RetrieveRequest(
                tenant_id=tenant_id,
                workspace_id=workspace_id,
                query=query,
                scope_ids=list(scope_ids),
                top_k=top_k,
                requester=requester,
            ),
            timeout=self._timeout_seconds,
            metadata=self._metadata,
        )
        return RetrieveResult(document_ids=tuple(hit.document_id for hit in response.hits))

    def close(self) -> None:
        self._channel.close()
