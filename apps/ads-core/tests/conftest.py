import hashlib

import pytest

from src.main import app as _real_app

# ENGINE-FIX-P5-SEC-1: ads-core enforces the internal service credential on
# every non-health route/RPC. Configure the SHA-256 digest for the test run so
# the app boots and the auth dependency can validate callers.
_TOKEN = "integration-token"

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
def _internal_service_token_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "INTERNAL_SERVICE_TOKEN_SHA256",
        hashlib.sha256(_TOKEN.encode("utf-8")).hexdigest(),
    )
