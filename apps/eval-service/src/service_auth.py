# Internal service-to-service auth (INTERNAL_SERVICE_TOKEN).
#
# Same scheme memory-service uses: a shared token, configured on a callee as the
# SHA-256 of the raw token ("INTERNAL_SERVICE_TOKEN_SHA256"), and sent by a
# caller as "Authorization: Bearer <INTERNAL_SERVICE_TOKEN>". Every non-exempt
# request and RPC is verified; a missing/bad credential is rejected with 401
# (HTTP) or UNAUTHENTICATED (gRPC). Callers do NOT need the digest, only the raw
# token. This is defense-in-depth for an already-trusted boundary, not a
# replacement for network isolation.

from __future__ import annotations

import hashlib
import hmac
import os
import re
from dataclasses import dataclass
from typing import Any

import grpc
from fastapi import Depends, Header, HTTPException, Request

_TENANT_RE = re.compile(
    r"^ten_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_BEARER = "Bearer "


@dataclass(frozen=True)
class Actor:
    """Resolved internal service principal. Currently just the tenant it acts for."""

    tenant_id: str


class ServiceAuthError(Exception):
    """Raised when the presented service credential is missing or invalid."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


class ServiceAuthNotConfigured(Exception):
    """Raised when the service token digest is not configured on this process."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


def _expected_digest() -> str:
    digest = os.environ.get("INTERNAL_SERVICE_TOKEN_SHA256", "").strip()
    if not digest:
        raise ServiceAuthNotConfigured(
            "INTERNAL_SERVICE_TOKEN_SHA256 is not configured; internal service auth cannot run."
        )
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ServiceAuthNotConfigured(
            "INTERNAL_SERVICE_TOKEN_SHA256 must be a 64-character lowercase hex SHA-256 digest."
        )
    return digest


def verify_service_token(authorization: str | None) -> Actor:
    """Validate the bearer token and return the resolved actor.

    Raises ServiceAuthError on a missing/invalid token, ServiceAuthNotConfigured
    if the digest is missing.
    """
    expected = _expected_digest()
    if not authorization or not authorization.startswith(_BEARER):
        raise ServiceAuthError("Missing or malformed internal service token.")
    presented = authorization[len(_BEARER) :].strip()
    if not hmac.compare_digest(
        hashlib.sha256(presented.encode("utf-8")).hexdigest(), expected
    ):
        raise ServiceAuthError("Invalid internal service token.")
    return Actor(tenant_id="default")


def require_tenant(actor: Actor, tenant_id: str | None) -> None:
    """Reject cross-tenant access for an internal caller."""
    if actor.tenant_id != tenant_id:
        raise ServiceAuthError("Cross-tenant internal service access is not allowed.")


def fastapi_dependency(
    exempt_paths: frozenset[str] = frozenset(),
    exempt_path_prefixes: frozenset[str] = frozenset(),
) -> Any:
    """Return a FastAPI dependency that enforces the service token on every request
    except those whose path is in ``exempt_paths`` (e.g. ``/health``) or starts with
    one of ``exempt_path_prefixes``."""

    def _require(request: Request, authorization: str | None = Header(default=None)) -> None:
        if request.url.path in exempt_paths or any(
            request.url.path.startswith(prefix) for prefix in exempt_path_prefixes
        ):
            return
        try:
            verify_service_token(authorization)
        except ServiceAuthNotConfigured as error:
            raise HTTPException(
                status_code=500,
                detail=f"Internal service auth not configured: {error}",
            )
        except ServiceAuthError as error:
            raise HTTPException(
                status_code=401,
                detail=f"Unauthorized internal service request: {error}",
            )

    return Depends(_require)


def assert_configured_at_startup() -> None:
    """Call during startup so a missing credential is a boot failure, not a
    per-request 500 discovered in production."""
    _expected_digest()


class ServiceAuthInterceptor(grpc.aio.ServerInterceptor):  # type: ignore[misc]
    """grpc.aio server interceptor enforcing the service credential on every RPC."""

    def __init__(self, exempt_methods: frozenset[str] = frozenset()) -> None:
        # Health checks only. Never exempt a data method.
        self._exempt = exempt_methods

    async def intercept_service(
        self,
        continuation: Any,
        handler_call_details: Any,
    ) -> Any:
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


class SyncServiceAuthInterceptor(grpc.ServerInterceptor):  # type: ignore[misc]
    """Sync-grpc server interceptor enforcing the service credential on every RPC."""

    def __init__(self, exempt_methods: frozenset[str] = frozenset()) -> None:
        self._grpc = grpc
        self._exempt = exempt_methods
        super().__init__()

    def intercept_service(
        self,
        continuation: Any,
        handler_call_details: Any,
    ) -> Any:
        if handler_call_details.method in self._exempt:
            return continuation(handler_call_details)

        metadata = dict(handler_call_details.invocation_metadata or ())
        try:
            verify_service_token(metadata.get("authorization"))
        except (ServiceAuthError, ServiceAuthNotConfigured) as error:
            error_detail = str(error)

            def abort(_request: Any, context: Any) -> None:
                context.abort(grpc.StatusCode.UNAUTHENTICATED, error_detail)

            return grpc.unary_unary_rpc_method_handler(abort)

        return continuation(handler_call_details)
