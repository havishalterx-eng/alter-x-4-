"""Locked CreatePersona protobuf mirrors and PLAN-8 outcome type."""

from pydantic import BaseModel, ConfigDict

from src.capability_resolver.models import AgentId
from src.selection_binding.models import (
    NoAgentMatch,
    NonEmptyString,
    TenantId,
    Uint32,
    WorkspaceId,
)


class _StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class CreatePersonaRequest(_StrictFrozenModel):
    tenant_id: TenantId
    workspace_id: WorkspaceId
    capability_profile_json: NonEmptyString


class CreatePersonaResponse(_StrictFrozenModel):
    agent_id: AgentId
    agent_version: Uint32
    persona_json: NonEmptyString


PersonaCreationOutcome = CreatePersonaResponse | NoAgentMatch
