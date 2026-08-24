"""Outbound caller half of the internal service-auth contract.

Every eval execution client speaks to another Alter service whose HTTP
surface is protected by that service's `service_auth.fastapi_dependency`
(ENGINE-FIX-P5-SEC-1). The callee fails closed when its
INTERNAL_SERVICE_TOKEN_SHA256 is unset; this helper is the matching caller
half -- it attaches `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` when
the raw token is configured and attaches nothing otherwise.

Attach-if-set rather than hard-fail on purpose: the same clients also drive
local fixture servers in the test-suite (see tests/fixtures/), where no
credential exists. Production environments set INTERNAL_SERVICE_TOKEN for
every service (docs/local-dev.md), so production traffic always carries the
header while the callee's own boot-time assert guarantees it is required.
"""

from __future__ import annotations

import os


def internal_service_token() -> str:
    return os.environ.get("INTERNAL_SERVICE_TOKEN", "").strip()


def internal_service_auth_headers() -> dict[str, str]:
    token = internal_service_token()
    if not token:
        return {}
    return {"authorization": f"Bearer {token}"}


def internal_service_auth_metadata() -> list[tuple[str, str]]:
    """gRPC variant of `internal_service_auth_headers`."""
    token = internal_service_token()
    if not token:
        return []
    return [("authorization", f"Bearer {token}")]
