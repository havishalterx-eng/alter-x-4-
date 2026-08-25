"""Real gRPC client to verification-service's VerifyService (HARD-7).

Sync grpc client -- eval-service is a sync SQLAlchemy service throughout
(see src/hardening.py's SqlAlchemyRegressionCaseStore), no reason to
introduce asyncio just for this one caller.
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from alter.verify.v1 import verify_pb2, verify_pb2_grpc
from src.execution.internal_auth import internal_service_auth_metadata

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class ScoreNodeInlineResult:
    verdict: str
    score: float
    threshold: float
    reviewer_model: str
    details_json: str


class VerificationClient:
    def __init__(self, target: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._channel = grpc.insecure_channel(target)
        self._stub = verify_pb2_grpc.VerifyServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds
        # ENGINE-FIX-P5-SEC-1: VerifyService's interceptor rejects every RPC
        # without the internal service credential.
        self._metadata = internal_service_auth_metadata()

    def score_node_inline(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        node_key: str,
        node_type: str,
        config_json: str,
        output_json: str,
    ) -> ScoreNodeInlineResult:
        response = self._stub.ScoreNodeInline(
            verify_pb2.ScoreNodeInlineRequest(
                tenant_id=tenant_id,
                run_id=run_id,
                node_execution_id=node_execution_id,
                node_key=node_key,
                node_type=node_type,
                config_json=config_json,
                output_json=output_json,
            ),
            timeout=self._timeout_seconds,
            metadata=self._metadata,
        )
        return ScoreNodeInlineResult(
            verdict=response.verdict,
            score=response.score,
            threshold=response.threshold,
            reviewer_model=response.reviewer_model,
            details_json=response.details_json,
        )

    def close(self) -> None:
        self._channel.close()
