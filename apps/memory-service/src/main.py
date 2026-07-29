from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .drift.router import drift_lifespan
from .drift.router import router as drift_router
from .memory_learning.router import memory_learning_lifespan
from .memory_learning.router import router as memory_learning_router
from .policy_store.router import policy_store_lifespan
from .policy_store.router import router as policy_store_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with memory_learning_lifespan(app):
        async with policy_store_lifespan(app):
            async with drift_lifespan(app):
                yield


app = FastAPI(lifespan=lifespan)

app.include_router(memory_learning_router)
app.include_router(policy_store_router)
app.include_router(drift_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "memory-service"}
