from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.config import get_settings

from .models import (
    PromoteMemoryRequest,
    PromoteMemoryResponse,
    UpdatePolicyRequest,
    UpdatePolicyResponse,
)
from .repository import (
    MemoryNotFoundError,
    MemoryPromotionConflictError,
    PolicyNotFoundError,
    PolicyTransitionError,
    PolicyVersionConflictError,
    SqlAlchemyPolicyStoreRepository,
)
from .service import PolicyStoreService, PolicyStoreValidationError

_default_service: PolicyStoreService | None = None


@asynccontextmanager
async def policy_store_lifespan(app: FastAPI) -> AsyncIterator[None]:
    del app
    global _default_service
    settings = get_settings()
    tenant_engine = create_engine(settings.policy_db_url_sync, pool_pre_ping=True)
    system_engine = create_engine(settings.policy_db_system_url_sync, pool_pre_ping=True)
    _default_service = PolicyStoreService(
        SqlAlchemyPolicyStoreRepository(
            sessionmaker(tenant_engine, class_=Session, expire_on_commit=False),
            sessionmaker(system_engine, class_=Session, expire_on_commit=False),
        )
    )
    try:
        yield
    finally:
        _default_service = None
        system_engine.dispose()
        tenant_engine.dispose()


def get_policy_store_service() -> PolicyStoreService:
    if _default_service is None:
        raise RuntimeError("PolicyStoreService not initialised")
    return _default_service


ServiceDep = Annotated[PolicyStoreService, Depends(get_policy_store_service)]
AuthorizationHeader = Annotated[str, Header(alias="Authorization")]
router = APIRouter(prefix="/memory", tags=["policy-store"])


@router.post("/update-policy", response_model=UpdatePolicyResponse)
async def update_policy(
    request: UpdatePolicyRequest,
    service: ServiceDep,
    authorization: AuthorizationHeader,
) -> UpdatePolicyResponse:
    try:
        return await service.update_policy(request, authorization)
    except (PolicyStoreValidationError, PolicyTransitionError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except PolicyNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except PolicyVersionConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/promote-memory", response_model=PromoteMemoryResponse)
async def promote_memory(
    request: PromoteMemoryRequest,
    service: ServiceDep,
    authorization: AuthorizationHeader,
) -> PromoteMemoryResponse:
    try:
        return await service.promote_memory(request, authorization)
    except PolicyStoreValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except MemoryNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except MemoryPromotionConflictError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
