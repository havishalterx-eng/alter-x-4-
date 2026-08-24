from __future__ import annotations

import hashlib

import pytest


@pytest.fixture(autouse=True)
def _configure_internal_service_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give legitimate service-path tests their non-production credential.

    Mirrors apps/memory-service/tests/conftest.py. Router specs that drive
    the real app must present this token (see the shared AUTH_HEADERS constant
    in each spec) because ENGINE-FIX-P5-SEC-1 enforces it at application
    level; /health stays exempt.
    """
    monkeypatch.setenv(
        "INTERNAL_SERVICE_TOKEN_SHA256",
        hashlib.sha256(b"integration-token").hexdigest(),
    )


# Present this header on every request a router spec sends to the real app.
AUTH_HEADERS = {"authorization": "Bearer integration-token"}
