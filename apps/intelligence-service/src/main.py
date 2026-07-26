from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .planner.router import planner_lifespan
from .planner.router import router as planner_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with planner_lifespan(app):
        yield


app = FastAPI(lifespan=lifespan)

app.include_router(planner_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "intelligence-service"}
