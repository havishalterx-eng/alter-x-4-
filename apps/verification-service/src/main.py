from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .verification.router import router as verification_router
from .verification.router import verification_lifespan


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with verification_lifespan(app):
        yield


app = FastAPI(lifespan=lifespan)

app.include_router(verification_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "verification-service"}
