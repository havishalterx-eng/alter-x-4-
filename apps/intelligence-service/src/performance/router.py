from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import get_settings
from src.db.ids import validate_prefixed_id
from src.db.session import get_db_session

from .models import AgentPerformanceResponse, DriftCandidateResponse
from .repository import PerformanceRepository

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
AuthorizationHeader = Annotated[str, Header(alias="Authorization")]
router = APIRouter(prefix="/internal/performance", tags=["performance"])
_drift_session_factory: async_sessionmaker[AsyncSession] | None = None


@asynccontextmanager
async def performance_lifespan(app: FastAPI) -> AsyncIterator[None]:
    del app
    global _drift_session_factory
    engine = create_async_engine(
        get_settings().intelligence_drift_reader_db_url, pool_pre_ping=True
    )
    _drift_session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield
    finally:
        _drift_session_factory = None
        await engine.dispose()


async def get_drift_session() -> AsyncIterator[AsyncSession]:
    if _drift_session_factory is None:
        raise RuntimeError("drift discovery session not initialised")
    async with _drift_session_factory() as session:
        yield session


DriftSessionDep = Annotated[AsyncSession, Depends(get_drift_session)]


@router.get("/agents/{agent_id}", response_model=AgentPerformanceResponse)
async def agent_performance(
    session: SessionDep,
    authorization: AuthorizationHeader,
    agent_id: Annotated[str, Path()],
    tenant_id: Annotated[str, Query()],
    task_class: Annotated[str, Query(min_length=1, max_length=100)],
    limit: Annotated[int, Query(ge=4, le=200)] = 40,
) -> AgentPerformanceResponse:
    if not authorization.startswith("Bearer ") or not authorization.removeprefix(
        "Bearer "
    ).strip():
        raise HTTPException(status_code=401, detail="valid bearer authorization is required")
    try:
        validate_prefixed_id("ten", tenant_id)
        validate_prefixed_id("agt", agent_id)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    tenant_uuid = tenant_id.removeprefix("ten_")
    observations = await PerformanceRepository(session).load_agent_observations(
        tenant_uuid=tenant_uuid,
        agent_id=agent_id,
        task_class=task_class,
        limit=limit,
    )
    return AgentPerformanceResponse(
        agent_id=agent_id,
        task_class=task_class,
        observations=observations,
    )


@router.get("/drift-candidates", response_model=DriftCandidateResponse)
async def drift_candidates(
    session: DriftSessionDep,
    authorization: AuthorizationHeader,
    minimum_observations: Annotated[int, Query(ge=4, le=200)],
) -> DriftCandidateResponse:
    if not authorization.startswith("Bearer ") or not authorization.removeprefix(
        "Bearer "
    ).strip():
        raise HTTPException(status_code=401, detail="valid bearer authorization is required")
    return DriftCandidateResponse(
        candidates=await PerformanceRepository(session).list_drift_candidates(
            minimum_observations=minimum_observations
        )
    )
