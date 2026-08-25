from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.main import app as real_app
from src.service_auth import fastapi_dependency


def _build_protected_app() -> FastAPI:
    app = FastAPI(
        dependencies=[fastapi_dependency(frozenset({"/health"}))]
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/protected")
    def protected() -> dict[str, str]:
        return {"status": "ok"}

    return app


def test_protected_route_rejects_missing_token() -> None:
    client = TestClient(_build_protected_app())
    assert client.get("/protected").status_code == 401


def test_protected_route_rejects_bad_token() -> None:
    client = TestClient(
        _build_protected_app(), headers={"authorization": "Bearer wrong-token"}
    )
    assert client.get("/protected").status_code == 401


def test_protected_route_accepts_valid_token() -> None:
    client = TestClient(
        _build_protected_app(), headers={"authorization": "Bearer integration-token"}
    )
    assert client.get("/protected").status_code == 200


def test_health_route_is_exempt() -> None:
    assert TestClient(_build_protected_app()).get("/health").status_code == 200


def test_real_app_registers_service_auth_dependency() -> None:
    assert any(
        getattr(dep.dependency, "__module__", "") == "src.service_auth"
        for dep in real_app.router.dependencies
    ), "production app does not register the service_auth dependency"
