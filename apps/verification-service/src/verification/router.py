"""FastAPI router exposing the VerificationService contract as HTTP endpoints.

Route paths mirror alter.verification.v1.VerificationService RPC names:
  POST /verification/score-node → VerificationService.ScoreNode

The kernel is injected via FastAPI's Depends mechanism so tests can swap in
any VerificationKernel instance without app-level state mutation.
"""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, status

from .kernel import VerificationKernel, VerificationValidationError
from .m2m_auth import lazy_auth0_m2m_token_provider_from_environment
from .model_gateway_client import GrpcModelGatewayClient
from .models import ScoreNodeRequest, ScoreNodeResponse
from .policy_client import HttpQualityThresholdPolicyClient

# ---------------------------------------------------------------------------
# Default kernel (wired with stubs; swap at integration time)
# ---------------------------------------------------------------------------

_default_kernel: VerificationKernel | None = None


@asynccontextmanager
async def verification_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialise the default kernel on startup."""
    global _default_kernel

    model_gateway_target = os.environ.get("MODEL_GATEWAY_GRPC_TARGET") or os.environ.get(
        "MODEL_GATEWAY_ADDRESS"
    )
    if not model_gateway_target:
        raise RuntimeError("MODEL_GATEWAY_ADDRESS or MODEL_GATEWAY_GRPC_TARGET is required")
    
    model_gateway = GrpcModelGatewayClient(
        model_gateway_target,
        access_token_provider=lazy_auth0_m2m_token_provider_from_environment(),
    )
    memory_service_base_url = os.environ.get("MEMORY_SERVICE_BASE_URL")
    internal_service_token = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
    policy_client = (
        HttpQualityThresholdPolicyClient(
            memory_service_base_url, f"Bearer {internal_service_token}"
        )
        if memory_service_base_url
        else None
    )
    _default_kernel = VerificationKernel(model_gateway, policy_client)
    yield
    await model_gateway.close()
    if policy_client is not None:
        await policy_client.close()
    _default_kernel = None


def get_kernel() -> VerificationKernel:
    if _default_kernel is None:
        raise RuntimeError(
            "VerificationKernel not initialised — call verification_lifespan first"
        )
    return _default_kernel


KernelDep = Annotated[VerificationKernel, Depends(get_kernel)]

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/verification", tags=["verification"])


@router.post(
    "/score-node",
    response_model=ScoreNodeResponse,
    status_code=status.HTTP_200_OK,
)
async def score_node(
    request: ScoreNodeRequest,
    kernel: KernelDep,
) -> ScoreNodeResponse:
    try:
        return await kernel.score_node(request)
    except VerificationValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc
