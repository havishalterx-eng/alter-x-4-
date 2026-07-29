from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .performance.router import router as performance_router
from .planner.router import planner_lifespan
from .planner.router import router as planner_router
from .selection_binding.router import router as selection_binding_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with planner_lifespan(app):
        yield


app = FastAPI(lifespan=lifespan)

app.include_router(planner_router)
app.include_router(selection_binding_router)
app.include_router(performance_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "intelligence-service"}
