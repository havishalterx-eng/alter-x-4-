from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.ids import validate_prefixed_id
from src.db.session import get_db_session

from .models import AgentPerformanceResponse
from .repository import PerformanceRepository

SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
AuthorizationHeader = Annotated[str, Header(alias="Authorization")]
router = APIRouter(prefix="/internal/performance", tags=["performance"])


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
