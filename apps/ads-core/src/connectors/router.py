from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from starlette.concurrency import run_in_threadpool

from src.ingestion.models import IngestionJobResponse

from .dispatcher import ConnectorSyncService
from .providers import ConnectorSyncError
from .repository import ConnectorSourceNotFoundError

router = APIRouter(prefix="/ads", tags=["ads-connectors"])

_default_service: ConnectorSyncService | None = None


def configure_connector_service(service: ConnectorSyncService | None) -> None:
    global _default_service
    _default_service = service


def get_connector_service() -> ConnectorSyncService:
    if _default_service is None:
        raise RuntimeError("Connector sync service is not initialized")
    return _default_service


ConnectorServiceDep = Annotated[ConnectorSyncService, Depends(get_connector_service)]
TenantId = Annotated[str, Header(alias="X-Alter-Tenant-Id")]


@router.post(
    "/sources/{source_id}/actions/sync",
    response_model=tuple[IngestionJobResponse, ...],
    status_code=status.HTTP_202_ACCEPTED,
)
async def scheduled_sync(
    source_id: str,
    service: ConnectorServiceDep,
    tenant_id: TenantId,
) -> tuple[IngestionJobResponse, ...]:
    try:
        return await run_in_threadpool(
            service.scheduled_sync, tenant_id=tenant_id, source_id=source_id
        )
    except ConnectorSourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ConnectorSyncError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.post(
    "/connectors/{provider}/webhooks/{source_id}",
    response_model=tuple[IngestionJobResponse, ...],
    status_code=status.HTTP_202_ACCEPTED,
)
async def webhook_sync(
    provider: str,
    source_id: str,
    request: Request,
    service: ConnectorServiceDep,
    tenant_id: TenantId,
) -> tuple[IngestionJobResponse, ...]:
    try:
        return await run_in_threadpool(
            service.webhook_sync,
            tenant_id=tenant_id,
            source_id=source_id,
            provider=provider,
            headers={key.lower(): value for key, value in request.headers.items()},
            body=await request.body(),
        )
    except ConnectorSourceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (ConnectorSyncError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
