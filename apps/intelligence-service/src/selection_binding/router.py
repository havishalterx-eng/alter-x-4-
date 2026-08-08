"""FastAPI router for the real internal selection-binding path.

Route:
  POST /selection-binding/bind-agent-model-tool

The engine needs a per-request AsyncSession (unlike verification's singleton
kernel), so it is constructed per-request from injected dependencies rather
than cached at app startup.

The embedding_client is a real GrpcEmbeddingClient (Model Gateway's Embed
RPC), opened once at app startup and reused across requests -- same
lifespan-managed-singleton pattern planner/router.py's GrpcAdsClient uses,
not a per-request channel. See selection_binding_lifespan below and
embedding_client.py's own module doc for what closed this gap.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from src.capability_resolver.models import NodeType
from src.db.session import get_db_session
from src.selection_binding.embedding_client import (
    EmbeddingClient,
    EmbeddingTransportUnavailableError,
    GrpcEmbeddingClient,
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
from src.selection_binding.policy_client import HttpRoutingPolicyClient, RoutingPolicyClient

_default_embedding_client: EmbeddingClient | None = None
_default_policy_client: HttpRoutingPolicyClient | None = None


@asynccontextmanager
async def selection_binding_lifespan(app: FastAPI) -> AsyncIterator[None]:
    del app
    global _default_embedding_client, _default_policy_client

    from ..config import get_settings

    settings = get_settings()
    client = GrpcEmbeddingClient(
        settings.model_gateway_grpc_target,
        timeout_seconds=settings.model_gateway_grpc_timeout_seconds,
    )
    policy_client = HttpRoutingPolicyClient(
        settings.memory_service_base_url,
        "Bearer intelligence-service",
    )
    _default_embedding_client = client
    _default_policy_client = policy_client
    try:
        yield
    finally:
        await client.close()
        _default_embedding_client = None
        await policy_client.close()
        _default_policy_client = None


def get_embedding_client() -> EmbeddingClient:
    if _default_embedding_client is None:
        raise RuntimeError(
            "EmbeddingClient not initialised -- call selection_binding_lifespan first"
        )
    return _default_embedding_client


def get_policy_client() -> RoutingPolicyClient:
    if _default_policy_client is None:
        raise RuntimeError(
            "RoutingPolicyClient not initialised -- call selection_binding_lifespan first"
        )
    return _default_policy_client


SessionDep = Annotated[AsyncSession, Depends(get_db_session)]
EmbeddingClientDep = Annotated[EmbeddingClient, Depends(get_embedding_client)]
PolicyClientDep = Annotated[RoutingPolicyClient, Depends(get_policy_client)]

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
    policy_client: PolicyClientDep,
) -> BindingOutcome:
    engine = SelectionBindingEngine(session, embedding_client, policy_client=policy_client)
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
