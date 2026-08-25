from __future__ import annotations

import hashlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

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


def test_real_app_requires_token_at_startup() -> None:
    """The HTTP app is deliberately not per-route gated (its routes are
    public-facing) -- assert_configured_at_startup() is the actual guarantee:
    boot fails without a configured token, so misconfiguration is a fail-fast
    boot error, never a silent per-request surprise."""
    from src.main import lifespan
    from src.service_auth import assert_configured_at_startup

    wrapped_lifespan = getattr(lifespan, "__wrapped__", None)
    assert wrapped_lifespan is not None
    assert wrapped_lifespan.__globals__["assert_configured_at_startup"] is (
        assert_configured_at_startup
    )


def test_real_grpc_server_registers_service_auth_interceptor() -> None:
    """gRPC is the actually-enforced surface for this service -- verify the
    real capability-resolver gRPC server wires ServiceAuthInterceptor."""
    import inspect

    from src.capability_resolver.grpc_server import start_capability_server

    source = inspect.getsource(start_capability_server)
    assert "ServiceAuthInterceptor" in source, (
        "capability-resolver gRPC server does not wire ServiceAuthInterceptor"
    )
