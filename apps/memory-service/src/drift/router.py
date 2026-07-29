from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.config import get_settings

from .detector import DriftDetector, DriftValidationError, InsufficientPerformanceDataError
from .intelligence_client import (
    HttpxIntelligencePerformanceClient,
    IntelligencePerformanceUnavailableError,
)
from .models import ComputeAgentDriftRequest, ComputeAgentDriftResponse
from .repository import SqlAlchemyDriftRepository

_default_detector: DriftDetector | None = None
_default_client: HttpxIntelligencePerformanceClient | None = None


@asynccontextmanager
async def drift_lifespan(app: FastAPI) -> AsyncIterator[None]:
    del app
    global _default_client, _default_detector
    settings = get_settings()
    system_engine = create_engine(settings.policy_db_system_url_sync, pool_pre_ping=True)
    _default_client = HttpxIntelligencePerformanceClient(
        str(settings.intelligence_service_base_url),
        settings.intelligence_service_timeout_seconds,
    )
    _default_detector = DriftDetector(
        _default_client,
        SqlAlchemyDriftRepository(
            sessionmaker(system_engine, class_=Session, expire_on_commit=False)
        ),
        window_size=settings.drift_window_size,
        failure_threshold=settings.drift_failure_threshold,
    )
    try:
        yield
    finally:
        _default_detector = None
        await _default_client.close()
        _default_client = None
        system_engine.dispose()


def get_drift_detector() -> DriftDetector:
    if _default_detector is None:
        raise RuntimeError("DriftDetector not initialised")
    return _default_detector


DetectorDep = Annotated[DriftDetector, Depends(get_drift_detector)]
AuthorizationHeader = Annotated[str, Header(alias="Authorization")]
router = APIRouter(prefix="/drift", tags=["drift"])


@router.post("/agents/score", response_model=ComputeAgentDriftResponse)
async def compute_agent_drift(
    request: ComputeAgentDriftRequest,
    detector: DetectorDep,
    authorization: AuthorizationHeader,
) -> ComputeAgentDriftResponse:
    try:
        return await detector.compute_agent_drift(request, authorization)
    except DriftValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except InsufficientPerformanceDataError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except IntelligencePerformanceUnavailableError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
