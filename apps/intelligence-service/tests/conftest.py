from __future__ import annotations

import hashlib

import pytest


@pytest.fixture(autouse=True)
def _configure_internal_service_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give legitimate service-path tests their non-production fixture credential."""
    monkeypatch.setenv(
        "INTERNAL_SERVICE_TOKEN_SHA256",
        hashlib.sha256(b"integration-token").hexdigest(),
    )
