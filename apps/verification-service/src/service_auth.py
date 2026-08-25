"""Internal service authentication — drop-in for every Python service.

Closes the callee half of findings 1 and 6: an internal endpoint must prove its
caller is a real Alter service before it acts on anything the caller says.

Mechanism is deliberately the one already proven in this repository —
`apps/ads-core/src/deletion/router.py:58-66`: a shared service token compared
as SHA-256 with `hmac.compare_digest`. No new dependency, no JWKS fetch, one
environment variable per service. It is the smallest change that is actually
correct, and it can ship without waiting on Auth0 M2M applications.

WHAT THIS GIVES YOU
    Authentication: the caller holds the service credential.

WHAT IT DOES NOT GIVE YOU
    Per-caller identity. Every service presents the same token, so this cannot
    tell orchestration-service from eval-service. Caller granularity comes from
    the per-service security groups in ../../02-per-service-security-groups.patch
    — the two layers compose: the security group says *which* service may
    connect, this token says *that it is a service at all*.

    When Auth0 M2M applications exist per service, replace `verify_service_token`
    with RS256 verification mirroring `packages/auth/session-gateway/src/m2m-validator.ts`
    (same issuer/audience/exp/nbf checks) and keep every call site unchanged.

ON TENANT IDENTITY — a correction worth stating plainly:
    An earlier draft of the review said "derive tenant_id from the credential,
    never from the request". That is right for a user-facing edge and WRONG for
    these internal services, which are legitimately called on behalf of many
    tenants by a trusted caller. The real defect was never that tenant_id
    travels on the wire — it is that nobody checked whether the caller was
    entitled to assert it. Authenticate the asserter and the message-borne
    tenant becomes sound. `require_tenant` below therefore validates format and
    binds against a tenant claim when one exists, rather than banning the field.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from dataclasses import dataclass
from typing import Any

import grpc
from fastapi import Request

_TENANT_RE = re.compile(
    r"^ten_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_BEARER = "Bearer "


class ServiceAuthError(Exception):
    """Caller did not present a valid service credential."""


class ServiceAuthNotConfigured(Exception):
    """The service has no credential configured. Fail closed, loudly, at startup."""


@dataclass(frozen=True)
class ServiceIdentity:
    """Authenticated caller. `tenant_id` is None until per-service tokens exist."""

    caller: str = "alter-service"
    tenant_id: str | None = None


def _expected_digest() -> str:
    digest = os.environ.get("INTERNAL_SERVICE_TOKEN_SHA256", "").strip()
    if len(digest) != 64 or not all(c in "0123456789abcdef" for c in digest.lower()):
        raise ServiceAuthNotConfigured(
            "INTERNAL_SERVICE_TOKEN_SHA256 must be the 64-char hex SHA-256 of the "
            "shared internal service token"
        )
    return digest.lower()


def verify_service_token(authorization: str | None) -> ServiceIdentity:
    """Authenticate a caller. Raises ServiceAuthError on anything short of valid.

    Constant-time comparison: a token is a secret, and a timing-variable compare
    leaks it byte by byte.
    """
    expected = _expected_digest()
    token = (
        authorization.removeprefix(_BEARER)
        if authorization is not None and authorization.startswith(_BEARER)
        else ""
    )
    if not token.strip():
        raise ServiceAuthError("valid bearer service credential is required")
    actual = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(actual, expected):
        raise ServiceAuthError("valid bearer service credential is required")
    return ServiceIdentity()


def require_tenant(identity: ServiceIdentity, requested_tenant_id: str) -> str:
    """Validate a message-borne tenant against the authenticated caller.

    Format is enforced here so no call site can forget it. When per-service
    tokens carry a tenant claim, a mismatch is rejected outright — that is the
    check that turns "any tenant the caller names" into "the tenant this
    credential is for".
    """
    if not _TENANT_RE.match(requested_tenant_id or ""):
        raise ServiceAuthError("tenant_id must be a ten_ prefixed UUIDv7")
    if identity.tenant_id is not None and identity.tenant_id != requested_tenant_id:
        raise ServiceAuthError("tenant_id does not match the authenticated credential")
    return requested_tenant_id


# ---------------------------------------------------------------------------
# FastAPI — mount at APPLICATION level so a new router cannot forget it.
#
#     from service_auth import fastapi_dependency
#     app = FastAPI(lifespan=lifespan, dependencies=[fastapi_dependency()])
#
# Health/readiness probes are the only routes that should opt out; give them
# their own router mounted on a separate FastAPI app, or check the path in the
# dependency. Do NOT switch to per-router dependencies — that is exactly how
# ads-core ended up with three unauthenticated routers and one authenticated one.
# ---------------------------------------------------------------------------
def fastapi_dependency(
    exempt_paths: frozenset[str] = frozenset(),
    exempt_path_prefixes: tuple[str, ...] = (),
) -> Any:
    from fastapi import Depends, Header, HTTPException, status

    def _require(
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> ServiceIdentity | None:
        if request.url.path in exempt_paths or request.url.path.startswith(exempt_path_prefixes):
            return None
        try:
            return verify_service_token(authorization)
        except ServiceAuthNotConfigured as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="internal service authentication is not configured",
            ) from error
        except ServiceAuthError as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error)
            ) from error

    return Depends(_require)


# ---------------------------------------------------------------------------
# gRPC — a server interceptor, so it cannot be forgotten per-RPC.
#
#     from service_auth import ServiceAuthInterceptor
#     server = grpc.aio.server(interceptors=[ServiceAuthInterceptor()])
# ---------------------------------------------------------------------------
class ServiceAuthInterceptor(grpc.aio.ServerInterceptor):
    """grpc.aio server interceptor enforcing the service credential on every RPC."""

    def __init__(self, exempt_methods: frozenset[str] = frozenset()) -> None:
        # Health checks only. Never exempt a data method.
        self._exempt = exempt_methods

    async def intercept_service(
        self,
        continuation: Any,
        handler_call_details: Any,
    ) -> Any:
        import grpc

        if handler_call_details.method in self._exempt:
            return await continuation(handler_call_details)

        metadata = dict(handler_call_details.invocation_metadata or ())
        authorization = metadata.get("authorization")
        try:
            verify_service_token(authorization)
        except (ServiceAuthError, ServiceAuthNotConfigured) as error:
            error_detail = str(error)

            async def abort(_request: Any, context: Any) -> None:
                await context.abort(grpc.StatusCode.UNAUTHENTICATED, error_detail)

            return grpc.unary_unary_rpc_method_handler(abort)

        return await continuation(handler_call_details)


def assert_configured_at_startup() -> None:
    """Call during startup so a missing credential is a boot failure, not a
    per-request 500 discovered in production."""
    _expected_digest()
