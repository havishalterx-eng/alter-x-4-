from __future__ import annotations

from concurrent import futures

import grpc
import pytest

from src.main import app as real_app
from src.service_auth import (
    SyncServiceAuthInterceptor,
    fastapi_dependency,
    verify_service_token,
)


def test_verify_service_token_rejects_missing() -> None:
    with pytest.raises(Exception):
        verify_service_token(None)


def test_verify_service_token_rejects_bad() -> None:
    with pytest.raises(Exception):
        verify_service_token("Bearer wrong-token")


def test_verify_service_token_accepts_valid() -> None:
    # Not configured in this process; the env fixture is set by conftest.
    token = "Bearer integration-token"
    assert verify_service_token(token) is not None


def test_http_protected_route_rejects_missing_token() -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI(dependencies=[fastapi_dependency(frozenset({"/health"}))])

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/protected")
    def protected() -> dict[str, str]:
        return {"status": "ok"}

    client = TestClient(app)
    assert client.get("/protected").status_code == 401
    assert client.get("/health").status_code == 200


def test_sync_grpc_interceptor_rejects_without_token() -> None:
    def handler(request: bytes, context: grpc.ServicerContext) -> bytes:
        return b"ok"

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=1),
        interceptors=[SyncServiceAuthInterceptor()],
    )
    server.add_generic_rpc_handlers(
        (
            grpc.method_handlers_generic_handler(
                "dummy.Dummy",
                {"Do": grpc.unary_unary_rpc_method_handler(handler)},
            ),
        )
    )
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        channel = grpc.insecure_channel(f"127.0.0.1:{port}")
        with pytest.raises(grpc.RpcError) as exc:
            channel.unary_unary("/dummy.Dummy/Do")(b"req", timeout=2)
        assert exc.value.code() == grpc.StatusCode.UNAUTHENTICATED
    finally:
        server.stop(None)


def test_sync_grpc_interceptor_accepts_with_token() -> None:
    def handler(request: bytes, context: grpc.ServicerContext) -> bytes:
        return b"ok"

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=1),
        interceptors=[SyncServiceAuthInterceptor()],
    )
    server.add_generic_rpc_handlers(
        (
            grpc.method_handlers_generic_handler(
                "dummy.Dummy",
                {"Do": grpc.unary_unary_rpc_method_handler(handler)},
            ),
        )
    )
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        channel = grpc.insecure_channel(f"127.0.0.1:{port}")
        response = channel.unary_unary("/dummy.Dummy/Do")(
            b"req",
            metadata=(("authorization", "Bearer integration-token"),),
            timeout=2,
        )
        assert response == b"ok"
    finally:
        server.stop(None)


def test_real_app_registers_service_auth_dependency() -> None:
    assert any(
        getattr(dep.dependency, "__module__", "") == "src.service_auth"
        for dep in real_app.router.dependencies
    ), "production app does not register the service_auth dependency"
