"""FastAPI router exposing the VerificationService contract as HTTP endpoints.

Route paths mirror alter.verification.v1.VerificationService RPC names:
  POST /verification/score-node → VerificationService.ScoreNode

The kernel is injected via FastAPI's Depends mechanism so tests can swap in
any VerificationKernel instance without app-level state mutation.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, status

from .kernel import VerificationKernel, VerificationValidationError
from .llm_client import StubReviewerLlmClient
from .models import ScoreNodeRequest, ScoreNodeResponse

# ---------------------------------------------------------------------------
# Default kernel (wired with stubs; swap at integration time)
# ---------------------------------------------------------------------------

_default_kernel: VerificationKernel | None = None


@asynccontextmanager
async def verification_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialise the default kernel on startup."""
    global _default_kernel

    _default_kernel = VerificationKernel(llm_client=StubReviewerLlmClient())
    yield
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
