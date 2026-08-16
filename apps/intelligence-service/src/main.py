from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .capability_registry.router import router as capability_registry_router
from .capability_resolver.grpc_server import start_capability_server
from .config import get_settings
from .performance.router import performance_lifespan
from .performance.router import router as performance_router
from .planner.router import planner_lifespan
from .planner.router import router as planner_router
from .problem_understanding.router import problem_understanding_lifespan
from .problem_understanding.router import router as problem_understanding_router
from .selection_binding.router import router as selection_binding_router
from .selection_binding.router import selection_binding_lifespan


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    capability_server = await start_capability_server(
        get_settings().capability_grpc_bind_address
    )
    try:
        async with performance_lifespan(app):
            async with planner_lifespan(app):
                async with problem_understanding_lifespan(app):
                    async with selection_binding_lifespan(app):
                        yield
    finally:
        await capability_server.stop(0)


app = FastAPI(lifespan=lifespan)

app.include_router(planner_router)
app.include_router(problem_understanding_router)
app.include_router(selection_binding_router)
app.include_router(performance_router)
app.include_router(capability_registry_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "intelligence-service"}
