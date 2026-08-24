from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .service_auth import assert_configured_at_startup, fastapi_dependency
from .verification.router import router as verification_router
from .verification.router import verification_lifespan


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    assert_configured_at_startup()
    async with verification_lifespan(app):
        yield


# ENGINE-FIX-P5-SEC-1: application-level internal-service auth; /health is the
# only exempt route. The gRPC surface (grpc_server.py) enforces the same
# credential via its own interceptor.
app = FastAPI(
    lifespan=lifespan,
    dependencies=[fastapi_dependency(frozenset({"/health"}))],
)

app.include_router(verification_router)


@app.get("/health", dependencies=[])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "verification-service"}
