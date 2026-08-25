from __future__ import annotations

import hashlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.main import app as real_app
from src.service_auth import fastapi_dependency


def _build_protected_app() -> FastAPI:
    """A minimal app wired exactly like the production app's auth dependency."""
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


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def test_protected_route_rejects_missing_token() -> None:
    app = _build_protected_app()
    client = TestClient(app)
    response = client.get("/protected")
    assert response.status_code == 401


def test_protected_route_rejects_bad_token() -> None:
    app = _build_protected_app()
    client = TestClient(app, headers={"authorization": "Bearer wrong-token"})
    response = client.get("/protected")
    assert response.status_code == 401


def test_protected_route_accepts_valid_token() -> None:
    app = _build_protected_app()
    client = TestClient(
        app, headers={"authorization": "Bearer integration-token"}
    )
    response = client.get("/protected")
    assert response.status_code == 200


def test_health_route_is_exempt() -> None:
    app = _build_protected_app()
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200


def test_real_app_registers_service_auth_dependency() -> None:
    """Pattern-3 wiring proof: the production app must actually carry the
    app-level service-auth dependency, not just have the module present."""
    assert any(
        getattr(dep.dependency, "__module__", "") == "src.service_auth"
        for dep in real_app.router.dependencies
    ), "production app does not register the service_auth dependency"
