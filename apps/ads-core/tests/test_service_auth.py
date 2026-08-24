import hashlib
import typing as _t

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.service_auth import (
    SyncServiceAuthInterceptor,
    assert_configured_at_startup,
    fastapi_dependency,
    verify_service_token,
)

TOKEN = "integration-token"


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _make_app() -> FastAPI:
    app = FastAPI(dependencies=[fastapi_dependency(frozenset({"/health"}))])

    @app.get("/health")
    def _health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/data")
    def _data() -> dict[str, str]:
        return {"ok": "true"}

    @app.get("/ads/anything")
    def _ads() -> dict[str, str]:
        return {"ok": "true"}

    return app


def _client() -> TestClient:
    return TestClient(_make_app())


def test_health_is_exempt() -> None:
    assert _client().get("/health").status_code == 200


def test_grpc_interceptor_aborts_without_a_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN_SHA256", _sha256(TOKEN))
    interceptor = SyncServiceAuthInterceptor()
    sentinel = object()

    def continuation(details: _t.Any) -> _t.Any:
        return sentinel

    handler = interceptor.intercept_service(
        continuation, _CallDetails("/adsq.AdsqService/Retrieve", ())
    )
    # Without a token the interceptor must NOT hand control to the real handler.
    assert handler is not sentinel


def test_grpc_interceptor_passes_through_with_a_valid_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN_SHA256", _sha256(TOKEN))
    interceptor = SyncServiceAuthInterceptor()
    sentinel = object()

    def continuation(details: _t.Any) -> _t.Any:
        return sentinel

    handler = interceptor.intercept_service(
        continuation,
        _CallDetails(
            "/adsq.AdsqService/Retrieve",
            (("authorization", f"Bearer {TOKEN}"),),
        ),
    )
    assert handler is sentinel


def test_protected_route_rejects_a_missing_token() -> None:
    response = _client().get("/data")
    assert response.status_code == 401


def test_protected_route_rejects_a_wrong_token() -> None:
    response = _client().get("/ads/anything", headers={"authorization": "Bearer wrong"})
    assert response.status_code == 401


def test_protected_route_accepts_a_valid_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN_SHA256", _sha256(TOKEN))
    response = _client().get("/data", headers={"authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 200


def test_missing_config_is_a_loud_500_not_a_silent_open_door(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("INTERNAL_SERVICE_TOKEN_SHA256", raising=False)
    response = _client().get("/data", headers={"authorization": f"Bearer {TOKEN}"})
    assert response.status_code == 500


def test_verify_service_token_rejects_a_malformed_header() -> None:
    with pytest.raises(Exception):
        verify_service_token("not-a-bearer-token")


def test_assert_configured_at_startup_passes_when_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN_SHA256", _sha256(TOKEN))
    assert_configured_at_startup()


class _CallDetails:
    def __init__(self, method: str, metadata: tuple[tuple[str, str], ...]) -> None:
        self.method = method
        self.invocation_metadata = metadata
