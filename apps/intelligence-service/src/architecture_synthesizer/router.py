from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from src.capability_registry.repository import CapabilityRegistryRepository
from src.capability_resolver.models import NodeRequirements
from src.capability_resolver.resolver import resolve_node_requirements
from src.db.session import get_db_session
from src.planner.task_skeleton import TaskSkeleton
from src.selection_binding.architecture_binder import ArchitectureBinder
from src.selection_binding.models import BindingBlocked, BindingRequest

from .models import (
    ArchitectureOutcome,
    ArchitectureSpec,
    ArchitectureSynthesisError,
    SynthesisConstraints,
    SynthesizeArchitectureRequest,
    TenantId,
    WorkspaceId,
)
from .registry_client import RepositoryCapabilityRegistryClient
from .service import ArchitectureSynthesizer

router = APIRouter(prefix="/internal/architecture-synthesis", tags=["architecture-synthesis"])
SessionDep = Annotated[AsyncSession, Depends(get_db_session)]


class PrepareCompilerInputRequest(BaseModel):
    """Internal pipeline hand-off. TaskSkeleton stays typed; JSON is never canonical here."""

    model_config = ConfigDict(extra="forbid", strict=True)

    tenant_id: TenantId
    workspace_id: WorkspaceId
    task_skeleton: TaskSkeleton
    constraints: SynthesisConstraints = SynthesisConstraints()


def _requirements(skeleton: TaskSkeleton) -> NodeRequirements:
    kinds = {"llm": "LLMTask", "tool": "ToolCall", "branch": "Gate", "join": "Merge"}
    return resolve_node_requirements([
        {"key": node.key, "type": kinds[node.type], "config": node.config, "metadata": {"ui": {}}}
        for node in skeleton.nodes
    ])


@router.post("/synthesize", response_model=ArchitectureOutcome)
async def synthesize(
    request: SynthesizeArchitectureRequest, session: SessionDep
) -> ArchitectureOutcome:
    try:
        registry = RepositoryCapabilityRegistryClient(CapabilityRegistryRepository(session))
        return await ArchitectureSynthesizer(registry).synthesize(request)
    except ArchitectureSynthesisError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/prepare-compiler-input")
async def prepare_compiler_input(
    request: PrepareCompilerInputRequest, session: SessionDep
) -> dict[str, object]:
    try:
        registry = CapabilityRegistryRepository(session)
        architecture = await ArchitectureSynthesizer(
            RepositoryCapabilityRegistryClient(registry)
        ).synthesize(
            SynthesizeArchitectureRequest(
                tenant_id=request.tenant_id,
                workspace_id=request.workspace_id,
                task_skeleton=request.task_skeleton,
                node_requirements=_requirements(request.task_skeleton),
                constraints=request.constraints,
            )
        )
        if not isinstance(architecture, ArchitectureSpec):
            return {"status": "blocked", "detail": architecture.model_dump(mode="json")}
        binding = await ArchitectureBinder(registry).bind(
            BindingRequest(
                tenant_id=request.tenant_id,
                workspace_id=request.workspace_id,
                architecture=architecture,
            )
        )
        if isinstance(binding, BindingBlocked):
            return {"status": "blocked", "detail": binding.model_dump(mode="json")}
        return {
            "status": "ready",
            "architecture": architecture.model_dump(mode="json"),
            "binding_decision": binding.model_dump(mode="json"),
        }
    except ArchitectureSynthesisError as error:
        await session.rollback()
        raise HTTPException(status_code=422, detail=str(error)) from error
