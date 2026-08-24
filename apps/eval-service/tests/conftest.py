from __future__ import annotations

import hashlib

import pytest


@pytest.fixture(autouse=True)
def _configure_internal_service_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-production credential for specs that drive the real app.

    Mirrors apps/memory-service/tests/conftest.py (ENGINE-FIX-P5-SEC-1).
    /health is exempt; every other route requires the bearer token.
    """
    monkeypatch.setenv(
        "INTERNAL_SERVICE_TOKEN_SHA256",
        hashlib.sha256(b"integration-token").hexdigest(),
    )
