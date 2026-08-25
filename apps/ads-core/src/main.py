from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .connectors.router import router as connectors_router
from .deletion.errors import DeletionHttpError, deletion_exception_handler
from .deletion.router import deletion_lifespan
from .deletion.router import router as deletion_router
from .ingestion.router import ingestion_lifespan
from .ingestion.router import router as ingestion_router
from .memory_namespace.router import router as memory_namespace_router
from .query.router import router as query_router
from .service_auth import assert_configured_at_startup, fastapi_dependency


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    assert_configured_at_startup()
    async with ingestion_lifespan(app):
        async with deletion_lifespan(app):
            yield


# One application-level dependency covers ingestion, connectors and query --
# the three routers that had no authentication at all -- as well as deletion,
# which keeps its own stricter token check underneath.
# Deletion routes retain their existing, purpose-specific authenticated router;
# exempting only this prefix preserves its RFC 9457 response contract.
# /ads/ingestion/uploads/complete is likewise exempt: it is deliberately
# client-reachable (interim trigger until a real S3-event/SQS consumer
# exists -- see its docstring) and already carries its own tenant-scoped
# validation (X-Alter-Tenant-Id header, upload_key ownership prefix check,
# real object existence via head_object) -- the internal-service token was
# never part of its contract.
app = FastAPI(
    lifespan=lifespan,
    dependencies=[
        fastapi_dependency(
            frozenset({"/health"}),
            exempt_path_prefixes=(
                "/internal/deletion/",
                "/ads/ingestion/uploads/complete",
            ),
        )
    ],
)
app.add_exception_handler(DeletionHttpError, deletion_exception_handler)  # type: ignore[arg-type]
app.include_router(ingestion_router)
app.include_router(connectors_router)
app.include_router(query_router)
app.include_router(memory_namespace_router)
app.include_router(deletion_router)


@app.get("/health", dependencies=[])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ads-core"}
