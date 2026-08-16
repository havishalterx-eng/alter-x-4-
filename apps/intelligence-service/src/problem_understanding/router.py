"""Private HTTP path for lifecycle-managed Problem Understanding."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, status

from .kernel import ProblemUnderstandingExecutionError, ProblemUnderstandingKernel
from .llm_client import ModelGatewayProblemUnderstandingClient
from .models import ProblemSpec, ProblemUnderstandingRequest

_default_kernel: ProblemUnderstandingKernel | None = None


@asynccontextmanager
async def problem_understanding_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Create and close resources owned by this internal route."""
    del app
    global _default_kernel

    from ..ads_client.client import GrpcAdsClient
    from ..config import get_settings
    from ..m2m_auth import lazy_auth0_m2m_token_provider_from_settings

    settings = get_settings()
    ads_client = GrpcAdsClient(
        settings.adsq_grpc_target,
        timeout_seconds=settings.adsq_grpc_timeout_seconds,
    )
    llm_client = ModelGatewayProblemUnderstandingClient(
        settings.model_gateway_grpc_target,
        timeout_seconds=settings.model_gateway_grpc_timeout_seconds,
        access_token_provider=lazy_auth0_m2m_token_provider_from_settings(settings),
    )
    _default_kernel = ProblemUnderstandingKernel(ads_client, llm_client)
    try:
        yield
    finally:
        await ads_client.close()
        await llm_client.close()
        _default_kernel = None


def get_kernel() -> ProblemUnderstandingKernel:
    if _default_kernel is None:
        raise RuntimeError(
            "ProblemUnderstandingKernel not initialised -- "
            "call problem_understanding_lifespan first"
        )
    return _default_kernel


KernelDep = Annotated[ProblemUnderstandingKernel, Depends(get_kernel)]

router = APIRouter(prefix="/internal/problem-understanding", tags=["problem-understanding"])


@router.post("/understand", response_model=ProblemSpec, status_code=status.HTTP_200_OK)
async def understand(
    request: ProblemUnderstandingRequest,
    kernel: KernelDep,
) -> ProblemSpec:
    try:
        return await kernel.understand(request)
    except ProblemUnderstandingExecutionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
