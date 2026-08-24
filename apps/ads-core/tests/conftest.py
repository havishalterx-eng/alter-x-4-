import hashlib

import pytest

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
