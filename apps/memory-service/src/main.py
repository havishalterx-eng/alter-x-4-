from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .memory_learning.router import memory_learning_lifespan
from .memory_learning.router import router as memory_learning_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with memory_learning_lifespan(app):
        yield


app = FastAPI(lifespan=lifespan)

app.include_router(memory_learning_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "memory-service"}
