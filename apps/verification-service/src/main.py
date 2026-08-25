from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .verification.router import router as verification_router
from .verification.router import verification_lifespan
from .service_auth import assert_configured_at_startup, fastapi_dependency


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # A missing credential is a boot failure, never a per-request surprise.
    assert_configured_at_startup()
    async with verification_lifespan(app):
        yield


# Application-level dependency: every current AND future router inherits it
# (same pattern as memory-service/ads-core -- per-router dependencies are how
# a new router silently ships unauthenticated).
app = FastAPI(
    lifespan=lifespan,
    dependencies=[fastapi_dependency(frozenset({"/health"}))],
)

app.include_router(verification_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "verification-service"}
