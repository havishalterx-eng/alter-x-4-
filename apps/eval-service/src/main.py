from fastapi import FastAPI

from .service_auth import assert_configured_at_startup, fastapi_dependency

# ENGINE-FIX-P5-SEC-1: application-level internal-service auth; /health is the
# only exempt route today. Eval's real RPC surface is the gRPC server
# (grpc_server.py), which carries the same credential requirement via its own
# interceptor.
app = FastAPI(
    dependencies=[fastapi_dependency(frozenset({"/health"}))],
)


@app.on_event("startup")
async def _assert_internal_service_auth_configured() -> None:
    # ENGINE-FIX-P5-SEC-1: fail closed at boot if the shared credential is unset.
    assert_configured_at_startup()


@app.get("/health", dependencies=[])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "eval-service"}
