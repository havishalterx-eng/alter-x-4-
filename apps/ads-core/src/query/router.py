from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from starlette.concurrency import run_in_threadpool

from .models import RetrievalRequest, RetrievalResponse
from .service import RetrievalService

router = APIRouter(prefix="/ads", tags=["ads-query"])

_default_service: RetrievalService | None = None


def configure_retrieval_service(service: RetrievalService | None) -> None:
    global _default_service
    _default_service = service


def get_retrieval_service() -> RetrievalService:
    if _default_service is None:
        raise RuntimeError("ADS Q is not initialized")
    return _default_service


ServiceDep = Annotated[RetrievalService, Depends(get_retrieval_service)]
TenantId = Annotated[str, Header(alias="X-Alter-Tenant-Id")]
WorkspaceId = Annotated[str, Header(alias="X-Alter-Workspace-Id")]
Requester = Annotated[str, Header(alias="X-Alter-Requester")]


@router.post("/query", response_model=RetrievalResponse, status_code=status.HTTP_200_OK)
async def query_ads(
    body: RetrievalRequest,
    service: ServiceDep,
    tenant_id: TenantId,
    workspace_id: WorkspaceId,
    requester: Requester,
) -> RetrievalResponse:
    if (body.tenant_id, body.workspace_id, body.requester) != (
        tenant_id,
        workspace_id,
        requester,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ADS Q request identity must match trusted caller headers",
        )
    try:
        return await run_in_threadpool(service.retrieve, body)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
