from __future__ import annotations

import hashlib

import pytest

from src.main import app as _real_app
from src.service_auth import _require as _auth_dependency


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


# ENGINE-FIX-P5-SEC-1: the app enforces the internal-service credential at the
# application level. Router/integration tests exercise business logic, not auth,
# so bypass the dependency here. The real enforcement is validated by
# tests/test_service_auth.py, which builds its own app with the dependency live.
_real_app.dependency_overrides[_auth_dependency] = lambda: None
