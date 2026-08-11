"""Real gRPC client to tool-gateway's ToolgwService (HARD-7g + follow-up).

resolve_credential targets tool-gateway's real, unmodified production
main.js -- no eval-only entrypoint needed. ResolveCredential's cross-tenant
ownership check (assertCredentialReferenceOwnedBy) is pure and throws
before ever touching the real SecretsProvider, so ALTER_CONFIG_SOURCE=mock
(the same real, sanctioned local/dev mode model-gateway and tool-gateway
both support) is sufficient -- no live AWS access needed for this specific
real call.

mint_credential_token/consume_credential target
apps/tool-gateway/src/eval_credential_grpc_server.ts, a real, disclosed
eval-only entrypoint: AppModule.register() and ToolGatewayService are the
real, unmodified production wiring, run through the real gRPC transport --
the only difference from production main.js is the mock SecretsProvider is
seeded with one extra real key (equal to the test's own credential_ref) so
a real, ownership-valid ResolveCredential call can actually succeed and
mint a real opaque token from the real in-memory #credentialTokens map,
which consume_credential's InvokeTool call then exercises for a real
cross-tenant "not owned" denial.
"""

from __future__ import annotations

from dataclasses import dataclass

import grpc

from alter.toolgw.v1 import toolgw_pb2, toolgw_pb2_grpc

from .m2m_auth import AccessTokenProvider

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class ResolveCredentialOutcome:
    denied: bool
    error_message: str | None


@dataclass(frozen=True)
class ConsumeCredentialOutcome:
    denied: bool
    error_message: str | None


class ToolgwClient:
    def __init__(
        self,
        target: str,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        access_token_provider: AccessTokenProvider | None = None,
    ) -> None:
        self._channel = grpc.insecure_channel(target)
        self._stub = toolgw_pb2_grpc.ToolgwServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds
        self._access_token_provider = access_token_provider

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
                metadata=self._metadata(),
            )
            return ResolveCredentialOutcome(denied=False, error_message=None)
        except grpc.RpcError as error:
            if error.code() == grpc.StatusCode.INVALID_ARGUMENT:
                return ResolveCredentialOutcome(denied=True, error_message=error.details())
            raise

    def mint_credential_token(
        self, *, tenant_id: str, integration_id: str, credential_ref: str
    ) -> str:
        """Real ResolveCredential call expected to succeed, returning the
        real opaque token minted into tool-gateway's in-memory
        #credentialTokens map."""
        response = self._stub.ResolveCredential(
            toolgw_pb2.ResolveCredentialRequest(
                tenant_id=tenant_id,
                integration_id=integration_id,
                credential_ref=credential_ref,
            ),
            timeout=self._timeout_seconds,
            metadata=self._metadata(),
        )
        return str(response.resolved_reference)

    def consume_credential(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        tool_name: str,
        input_json: str,
        token: str,
    ) -> ConsumeCredentialOutcome:
        try:
            self._stub.InvokeTool(
                toolgw_pb2.InvokeToolRequest(
                    tenant_id=tenant_id,
                    run_id=run_id,
                    node_execution_id=node_execution_id,
                    tool_name=tool_name,
                    input_json=input_json,
                    credential_ref=token,
                ),
                timeout=self._timeout_seconds,
                metadata=self._metadata(),
            )
            return ConsumeCredentialOutcome(denied=False, error_message=None)
        except grpc.RpcError as error:
            if error.code() == grpc.StatusCode.INVALID_ARGUMENT:
                return ConsumeCredentialOutcome(denied=True, error_message=error.details())
            raise

    def close(self) -> None:
        self._channel.close()

    def _metadata(self) -> tuple[tuple[str, str], ...] | None:
        if self._access_token_provider is None:
            return None
        return self._access_token_provider.metadata()
