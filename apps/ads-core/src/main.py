from fastapi import FastAPI

from .ingestion.router import ingestion_lifespan
from .ingestion.router import router as ingestion_router

app = FastAPI(lifespan=ingestion_lifespan)
app.include_router(ingestion_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ads-core"}
