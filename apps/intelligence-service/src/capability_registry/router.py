from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db_session

from .models import CapabilityRecord, CapabilitySearch, RegisterCapability
from .repository import CapabilityRegistryError, CapabilityRegistryRepository

router = APIRouter(prefix="/internal/capability-registry", tags=["capability-registry"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


@router.post("/{tenant_id}/records", response_model=CapabilityRecord)
async def register(
    tenant_id: str, request: RegisterCapability, session: SessionDep
) -> CapabilityRecord:
    try:
        return await CapabilityRegistryRepository(session).register(tenant_id, request)
    except CapabilityRegistryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/{tenant_id}/search", response_model=list[CapabilityRecord])
async def search(
    tenant_id: str, query: CapabilitySearch, session: SessionDep
) -> list[CapabilityRecord]:
    try:
        return await CapabilityRegistryRepository(session).search(tenant_id, query)
    except CapabilityRegistryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/{tenant_id}/records/{capability_id}/{version}", response_model=CapabilityRecord)
async def get(
    tenant_id: str, capability_id: str, version: int, session: SessionDep
) -> CapabilityRecord:
    try:
        return await CapabilityRegistryRepository(session).get(tenant_id, capability_id, version)
    except CapabilityRegistryError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/{tenant_id}/records/{capability_id}/{version}/deactivate", status_code=204)
async def deactivate(tenant_id: str, capability_id: str, version: int, session: SessionDep) -> None:
    try:
        await CapabilityRegistryRepository(session).deactivate(tenant_id, capability_id, version)
    except CapabilityRegistryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/{tenant_id}/records/{capability_id}/supersede", response_model=CapabilityRecord)
async def supersede(
    tenant_id: str, capability_id: str, request: RegisterCapability, session: SessionDep
) -> CapabilityRecord:
    try:
        return await CapabilityRegistryRepository(session).supersede(
            tenant_id, capability_id, request
        )
    except CapabilityRegistryError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
