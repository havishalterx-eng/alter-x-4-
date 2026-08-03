"""Real client for tenant-isolation's audit_event_read case.

Targets apps/audit-service/src/eval_bootstrap.ts, a real, disclosed
eval-only entrypoint reusing AuditGrpcController/AuditService/
PostgresAuditStoreProvider completely unmodified -- production's real
main.ts always requires live AWS Secrets Manager access (no
ALTER_CONFIG_SOURCE=mock escape hatch like model-gateway/tool-gateway
have), which isn't reachable here; the only shortcut is where the
Postgres connection string comes from, never the real GetEvent business
logic. The real cross-tenant NOT_FOUND comes entirely from
AuditService.getEvent()'s own real `stored.tenantId !== request.tenant_id`
check (see audit.service.ts's own module doc) -- deliberately
indistinguishable from an event that never existed.
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from alter.audit.v1 import audit_pb2, audit_pb2_grpc

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class GetEventResult:
    not_found: bool


class AuditEvalClient:
    def __init__(self, target: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._channel = grpc.insecure_channel(target)
        self._stub = audit_pb2_grpc.AuditServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds

    def record_cross_tenant_event(self, *, other_tenant_id: str) -> str:
        response = self._stub.RecordEvent(
            audit_pb2.RecordEventRequest(
                tenant_id=other_tenant_id,
                actor_type="service",
                actor_ref="eval-harness",
                action="eval.probe",
                target_type="",
                target_ref="",
                result="success",
                reason_code="",
                context_json="",
                occurred_at="2026-01-01T00:00:00Z",
            ),
            timeout=self._timeout_seconds,
        )
        return str(response.id)

    def check_get_event(self, *, tenant_id: str, event_id: str) -> GetEventResult:
        try:
            self._stub.GetEvent(
                audit_pb2.GetEventRequest(tenant_id=tenant_id, event_id=event_id),
                timeout=self._timeout_seconds,
            )
            return GetEventResult(not_found=False)
        except grpc.RpcError as error:
            if error.code() == grpc.StatusCode.NOT_FOUND:
                return GetEventResult(not_found=True)
            raise

    def close(self) -> None:
        self._channel.close()
