from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.config import get_settings

from .ads_core_client import HttpxAdsCoreMemoryClient
from .models import (
    GetActivePolicyRequest,
    GetActivePolicyResponse,
    PromoteMemoryRequest,
    PromoteMemoryResponse,
    RevertMemoryRequest,
    RevertMemoryResponse,
    UpdatePolicyRequest,
    UpdatePolicyResponse,
)
from .repository import (
    MemoryNotFoundError,
    MemoryPromotionConflictError,
    MemoryRevertConflictError,
    PolicyNotFoundError,
    PolicyPermissionError,
    PolicyTransitionError,
    PolicyVersionConflictError,
    SqlAlchemyPolicyStoreRepository,
)
from .service import PolicyStoreService, PolicyStoreValidationError

_default_service: PolicyStoreService | None = None
_default_ads_core_client: HttpxAdsCoreMemoryClient | None = None


@asynccontextmanager
async def policy_store_lifespan(app: FastAPI) -> AsyncIterator[None]:
    del app
    global _default_service, _default_ads_core_client
    settings = get_settings()
    tenant_engine = create_engine(settings.policy_db_url_sync, pool_pre_ping=True)
    system_engine = create_engine(settings.policy_db_system_url_sync, pool_pre_ping=True)
    _default_ads_core_client = HttpxAdsCoreMemoryClient(
        str(settings.ads_core_base_url),
        settings.ads_core_timeout_seconds,
    )
    _default_service = PolicyStoreService(
        SqlAlchemyPolicyStoreRepository(
            sessionmaker(tenant_engine, class_=Session, expire_on_commit=False),
            sessionmaker(system_engine, class_=Session, expire_on_commit=False),
        ),
        _default_ads_core_client,
    )
    try:
        yield
    finally:
        _default_service = None
        await _default_ads_core_client.close()
        _default_ads_core_client = None
        system_engine.dispose()
        tenant_engine.dispose()


def get_policy_store_service() -> PolicyStoreService:
    if _default_service is None:
        raise RuntimeError("PolicyStoreService not initialised")
    return _default_service


ServiceDep = Annotated[PolicyStoreService, Depends(get_policy_store_service)]
AuthorizationHeader = Annotated[str, Header(alias="Authorization")]
GlobalWriteHeader = Annotated[
    str | None, Header(alias="X-Alter-Policy-Global-Write")
]
router = APIRouter(prefix="/memory", tags=["policy-store"])


@router.post("/update-policy", response_model=UpdatePolicyResponse)
async def update_policy(
    request: UpdatePolicyRequest,
    service: ServiceDep,
    authorization: AuthorizationHeader,
    x_alter_policy_global_write: GlobalWriteHeader = None,
) -> UpdatePolicyResponse:
    try:
        return await service.update_policy(
            request, authorization, global_write_token=x_alter_policy_global_write
        )
    except (PolicyStoreValidationError, PolicyTransitionError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except PolicyNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except PolicyVersionConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except PolicyPermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error


@router.post("/promote-memory", response_model=PromoteMemoryResponse)
async def promote_memory(
    request: PromoteMemoryRequest,
    service: ServiceDep,
    authorization: AuthorizationHeader,
    x_alter_policy_global_write: GlobalWriteHeader = None,
) -> PromoteMemoryResponse:
    try:
        return await service.promote_memory(
            request, authorization, global_write_token=x_alter_policy_global_write
        )
    except PolicyStoreValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except MemoryNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except PolicyPermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except MemoryPromotionConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/revert-memory", response_model=RevertMemoryResponse)
async def revert_memory(
    request: RevertMemoryRequest,
    service: ServiceDep,
    authorization: AuthorizationHeader,
    x_alter_policy_global_write: GlobalWriteHeader = None,
) -> RevertMemoryResponse:
    try:
        return await service.revert_memory(
            request, authorization, global_write_token=x_alter_policy_global_write
        )
    except PolicyStoreValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except MemoryNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except PolicyPermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except MemoryRevertConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/active-policy", response_model=GetActivePolicyResponse)
async def get_active_policy(
    request: GetActivePolicyRequest,
    service: ServiceDep,
    authorization: AuthorizationHeader,
) -> GetActivePolicyResponse:
    try:
        return await service.get_active_policy(request, authorization)
    except PolicyStoreValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
