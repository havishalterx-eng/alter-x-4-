"""FastAPI router exposing the BindingService contract as HTTP endpoints.

Route paths mirror alter.binding.v1.BindingService RPC names:
  POST /selection-binding/bind-agent-model-tool -> BindingService.BindAgentModelTool

Mirrors verification-service's router pattern (FastAPI HTTP, not raw gRPC,
even though the locked .proto declares a gRPC service name/shape -- that is
this repo's real, established convention for exposing a Python service:
Planner and Verification both do the same). The engine needs a per-request
AsyncSession (unlike verification's singleton kernel), so it is constructed
per-request from injected dependencies rather than cached at app startup.

HEAL-6 PR B known gap: the embedding_client default (NotImplementedEmbeddingClient)
means the capability-similarity ranked-match path always fails closed with a
clear error. Only requests carrying a `preferred_agent_id` in their node
requirement succeed today -- see embedding_client.py's docstring.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from src.capability_resolver.models import NodeType
from src.db.session import get_db_session
from src.selection_binding.embedding_client import (
    EmbeddingClient,
    EmbeddingTransportUnavailableError,
    NotImplementedEmbeddingClient,
)
from src.selection_binding.engine import (
    BindingValidationError,
    EmbeddingResultError,
    SelectionBindingEngine,
)
from src.selection_binding.models import (
    BindAgentModelToolRequest,
    BindingContext,
    BindingOutcome,
    NodeKey,
    NonEmptyString,
    RunId,
    TenantId,
    WorkspaceId,
)


def get_embedding_client() -> EmbeddingClient:
    return NotImplementedEmbeddingClient()


SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
EmbeddingClientDep = Annotated[EmbeddingClient, Depends(get_embedding_client)]

router = APIRouter(prefix="/selection-binding", tags=["selection-binding"])


class BindAgentModelToolHttpRequest(BaseModel):
    """Locked proto fields plus the trusted context BindingContext needs.

    Callers (orchestration-service) already know workspace_id/node_type from
    their own compiled-DAG/run state -- this is an internal service call,
    not an untrusted public endpoint, so carrying that context alongside
    the proto-locked fields is consistent with BindingContext's own
    docstring ("Trusted internal context absent from the locked protobuf
    request").
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    tenant_id: TenantId
    run_id: RunId
    node_key: NodeKey
    node_requirements_json: NonEmptyString
    workspace_id: WorkspaceId
    node_type: NodeType
    task_category: NonEmptyString | None = None


@router.post("/bind-agent-model-tool", response_model_exclude_none=True)
async def bind_agent_model_tool(
    request: BindAgentModelToolHttpRequest,
    session: SessionDep,
    embedding_client: EmbeddingClientDep,
) -> BindingOutcome:
    engine = SelectionBindingEngine(session, embedding_client)
    bind_request = BindAgentModelToolRequest(
        tenant_id=request.tenant_id,
        run_id=request.run_id,
        node_key=request.node_key,
        node_requirements_json=request.node_requirements_json,
    )
    context = BindingContext(
        workspace_id=request.workspace_id,
        node_type=request.node_type,
        task_category=request.task_category,
    )
    try:
        outcome = await engine.bind(bind_request, context)
    except BindingValidationError as exc:
        await session.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except EmbeddingResultError as exc:
        await session.rollback()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except EmbeddingTransportUnavailableError as exc:
        await session.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception:
        await session.rollback()
        raise
    await session.commit()
    return outcome
