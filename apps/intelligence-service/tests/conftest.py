from __future__ import annotations

import hashlib

import pytest

from src.main import app as _real_app

# ENGINE-FIX-P5-SEC-1: the app enforces the internal-service credential at the
# application level. Router/integration tests exercise business logic, not auth,
# so bypass the dependency here. The real enforcement is validated by
# tests/test_service_auth.py, which builds its own app with the dependency live.
#
# We override by the exact dependency object registered on the app (discovered
# from app.router.dependencies) rather than importing it by name, so the key
# matches even if service_auth is imported under more than one module path.
for _dep in _real_app.router.dependencies:
    _callable = getattr(_dep, "dependency", None)
    if _callable is not None and getattr(_callable, "__module__", "") == "src.service_auth":
        _real_app.dependency_overrides[_callable] = lambda: None


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
