"""FastAPI router exposing the PlannerService contract as HTTP endpoints.

Route paths mirror alter.planner.v1.PlannerService RPC names:
  POST /planner/decompose         → PlannerService.Decompose
  POST /planner/replan            → PlannerService.Replan
  POST /planner/select-strategy   → PlannerService.SelectStrategy

The kernel is injected via FastAPI's Depends mechanism so tests can swap in
any PlannerKernel instance without app-level state mutation.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, status

from .kernel import PlannerKernel, PlannerValidationError
from .llm_client import StubLlmClient
from .models import (
    DecomposeRequest,
    DecomposeResponse,
    ReplanRequest,
    ReplanResponse,
    SelectStrategyRequest,
    SelectStrategyResponse,
)

# ---------------------------------------------------------------------------
# Default kernel
# ---------------------------------------------------------------------------

_default_kernel: PlannerKernel | None = None


@asynccontextmanager
async def planner_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialise the default kernel on startup."""
    global _default_kernel

    from ..ads_client.client import GrpcAdsClient
    from ..config import get_settings

    settings = get_settings()
    ads_client = GrpcAdsClient(
        settings.adsq_grpc_target,
        timeout_seconds=settings.adsq_grpc_timeout_seconds,
    )
    _default_kernel = PlannerKernel(
        ads_client=ads_client,
        llm_client=StubLlmClient(),
    )
    try:
        yield
    finally:
        await ads_client.close()
        _default_kernel = None


def get_kernel() -> PlannerKernel:
    if _default_kernel is None:
        raise RuntimeError("PlannerKernel not initialised — call planner_lifespan first")
    return _default_kernel


KernelDep = Annotated[PlannerKernel, Depends(get_kernel)]

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/planner", tags=["planner"])


@router.post(
    "/decompose",
    response_model=DecomposeResponse,
    status_code=status.HTTP_200_OK,
)
async def decompose(
    request: DecomposeRequest,
    kernel: KernelDep,
) -> DecomposeResponse:
    try:
        return await kernel.decompose(request)
    except PlannerValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc


@router.post(
    "/replan",
    response_model=ReplanResponse,
    status_code=status.HTTP_200_OK,
)
async def replan(
    request: ReplanRequest,
    kernel: KernelDep,
) -> ReplanResponse:
    try:
        return await kernel.replan(request)
    except PlannerValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc


@router.post(
    "/select-strategy",
    response_model=SelectStrategyResponse,
    status_code=status.HTTP_200_OK,
)
async def select_strategy_endpoint(
    request: SelectStrategyRequest,
    kernel: KernelDep,
) -> SelectStrategyResponse:
    return await kernel.select_strategy(request)
