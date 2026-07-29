from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .deletion.errors import DeletionHttpError, deletion_exception_handler
from .deletion.router import deletion_lifespan
from .deletion.router import router as deletion_router
from .ingestion.router import ingestion_lifespan
from .ingestion.router import router as ingestion_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with ingestion_lifespan(app):
        async with deletion_lifespan(app):
            yield


app = FastAPI(lifespan=lifespan)
app.add_exception_handler(DeletionHttpError, deletion_exception_handler)  # type: ignore[arg-type]
app.include_router(ingestion_router)
app.include_router(deletion_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ads-core"}
