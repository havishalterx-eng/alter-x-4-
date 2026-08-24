import hashlib

import pytest

from src.main import app as _real_app
from src.service_auth import _require as _auth_dependency

# ENGINE-FIX-P5-SEC-1: ads-core enforces the internal service credential on
# every non-health route/RPC. Configure the SHA-256 digest for the test run so
# the app boots and the auth dependency can validate callers.
_TOKEN = "integration-token"


@pytest.fixture(autouse=True)
def _internal_service_token_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "INTERNAL_SERVICE_TOKEN_SHA256",
        hashlib.sha256(_TOKEN.encode("utf-8")).hexdigest(),
    )


# ENGINE-FIX-P5-SEC-1: the app enforces the internal-service credential at the
# application level. Router/integration tests exercise business logic, not auth,
# so bypass the dependency here. The real enforcement is validated by
# tests/test_service_auth.py, which builds its own app with the dependency live.
_real_app.dependency_overrides[_auth_dependency] = lambda: None
