from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.capability_registry.repository import CapabilityRegistryRepository
from src.db.session import get_db_session

from .models import ArchitectureOutcome, ArchitectureSynthesisError, SynthesizeArchitectureRequest
from .registry_client import RepositoryCapabilityRegistryClient
from .service import ArchitectureSynthesizer

router = APIRouter(prefix="/internal/architecture-synthesis", tags=["architecture-synthesis"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


@router.post("/synthesize", response_model=ArchitectureOutcome)
async def synthesize(
    request: SynthesizeArchitectureRequest, session: SessionDep
) -> ArchitectureOutcome:
    try:
        registry = RepositoryCapabilityRegistryClient(CapabilityRegistryRepository(session))
        return await ArchitectureSynthesizer(registry).synthesize(request)
    except ArchitectureSynthesisError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
