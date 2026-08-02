"""Real gRPC client to tool-gateway's ToolgwService (HARD-7g).

Target is tool-gateway's real, unmodified production main.js -- no
eval-only entrypoint needed. ResolveCredential's cross-tenant ownership
check (assertCredentialReferenceOwnedBy) is pure and throws before ever
touching the real SecretsProvider, so ALTER_CONFIG_SOURCE=mock (the same
real, sanctioned local/dev mode model-gateway and tool-gateway both
support) is sufficient -- no live AWS access needed for this specific
real call.
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from alter.toolgw.v1 import toolgw_pb2, toolgw_pb2_grpc

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class ResolveCredentialOutcome:
    denied: bool
    error_message: str | None


class ToolgwClient:
    def __init__(self, target: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._channel = grpc.insecure_channel(target)
        self._stub = toolgw_pb2_grpc.ToolgwServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds

    def resolve_credential(
        self, *, tenant_id: str, integration_id: str, credential_ref: str
    ) -> ResolveCredentialOutcome:
        try:
            self._stub.ResolveCredential(
                toolgw_pb2.ResolveCredentialRequest(
                    tenant_id=tenant_id,
                    integration_id=integration_id,
                    credential_ref=credential_ref,
                ),
                timeout=self._timeout_seconds,
            )
            return ResolveCredentialOutcome(denied=False, error_message=None)
        except grpc.RpcError as error:
            if error.code() == grpc.StatusCode.INVALID_ARGUMENT:
                return ResolveCredentialOutcome(denied=True, error_message=error.details())
            raise

    def close(self) -> None:
        self._channel.close()
