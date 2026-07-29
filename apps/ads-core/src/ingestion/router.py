from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request, status
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from starlette.concurrency import run_in_threadpool

from src.config import get_settings

from .models import IngestionJobResponse, IngestionPayload
from .pipeline import IngestionPipeline
from .repository import SourceNotFoundError, SqlAlchemyIngestionRepository
from .scanner import DisclosedStubScanner
from .validation import PayloadValidator

_default_pipeline: IngestionPipeline | None = None


@asynccontextmanager
async def ingestion_lifespan(app: FastAPI) -> AsyncIterator[None]:
    del app
    global _default_pipeline
    settings = get_settings()
    engine = create_engine(settings.ads_db_url_sync, pool_pre_ping=True)
    sessions = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    allowed_content_types = frozenset(
        value.strip().lower()
        for value in settings.ads_ingestion_allowed_mime_types.split(",")
        if value.strip()
    )
    signatures = tuple(
        value.strip().encode("utf-8")
        for value in settings.ads_ingestion_stub_bad_signatures.split(",")
        if value.strip()
    )
    _default_pipeline = IngestionPipeline(
        repository=SqlAlchemyIngestionRepository(sessions),
        validator=PayloadValidator(
            max_content_bytes=settings.ads_ingestion_max_content_bytes,
            allowed_content_types=allowed_content_types,
        ),
        scanner=DisclosedStubScanner(signatures),
    )
    try:
        yield
    finally:
        _default_pipeline = None
        engine.dispose()


def get_ingestion_pipeline() -> IngestionPipeline:
    if _default_pipeline is None:
        raise RuntimeError("Ingestion pipeline is not initialized")
    return _default_pipeline


PipelineDep = Annotated[IngestionPipeline, Depends(get_ingestion_pipeline)]

router = APIRouter(prefix="/ads", tags=["ads-ingestion"])


@router.post(
    "/ingestion/uploads",
    response_model=IngestionJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_upload(
    request: Request,
    pipeline: PipelineDep,
    tenant_id: Annotated[str, Header(alias="X-Alter-Tenant-Id")],
    source_id: Annotated[str, Header(alias="X-Alter-Source-Id")],
) -> IngestionJobResponse:
    try:
        return await run_in_threadpool(
            pipeline.ingest,
            IngestionPayload(
                tenant_id=tenant_id,
                source_id=source_id,
                content_type=request.headers.get("content-type", ""),
                content=await request.body(),
            ),
        )
    except SourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
