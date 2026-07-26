"""PLAN-8 agent persona creation after a genuine PLAN-7 no-match result."""

import json

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.agent_auto_creation.models import (
    CreatePersonaRequest,
    CreatePersonaResponse,
    PersonaCreationOutcome,
)
from src.capability_resolver import NodeRequirement
from src.db.ids import new_prefixed_id
from src.selection_binding import (
    EmbeddingClient,
    NoAgentMatch,
    embedding_vector_literal,
)

_SET_TENANT_CONTEXT = text(
    "SELECT set_config('app.current_tenant_id', :tenant_id, true)"
)

_INSERT_AGENT = text(
    """
INSERT INTO agents
  (id, tenant_id, workspace_id, name, tier, persona_description, status)
VALUES
  (:agent_id, CAST(:tenant_id AS uuid), CAST(:workspace_id AS uuid),
   :name, 'STANDARD', :persona_description, 'active')
"""
)

_INSERT_AGENT_VERSION = text(
    """
INSERT INTO agent_versions
  (id, agent_id, tenant_id, version_number, config, published_at)
VALUES
  (:version_id, :agent_id, CAST(:tenant_id AS uuid), 1,
   CAST(:config_json AS jsonb), now())
"""
)

_INSERT_CAPABILITY_EMBEDDING = text(
    """
INSERT INTO capability_embeddings
  (id, agent_id, tenant_id, capability_description, embedding, embedding_metadata)
VALUES
  (:embedding_id, :agent_id, CAST(:tenant_id AS uuid), :capability_description,
   CAST(:embedding AS vector(512)), CAST(:embedding_metadata_json AS jsonb))
"""
)


class PersonaCreationValidationError(ValueError):
    pass


class AgentAutoCreationEngine:
    """Create one immediately-bindable STANDARD persona for a true no-match."""

    def __init__(
        self,
        session: AsyncSession,
        embedding_client: EmbeddingClient,
    ) -> None:
        self._session = session
        self._embedding_client = embedding_client

    async def create_for_no_match(
        self,
        no_match: NoAgentMatch,
        request: CreatePersonaRequest,
    ) -> PersonaCreationOutcome:
        if no_match.reason != "no_eligible_agent":
            return no_match

        requirement = _parse_capability_profile(request.capability_profile_json)
        if not requirement.capabilities:
            raise PersonaCreationValidationError(
                "no_eligible_agent requires at least one capability"
            )
        if requirement.preferred_agent_id is not None:
            raise PersonaCreationValidationError(
                "no_eligible_agent cannot carry preferred_agent_id"
            )

        persona_description = _persona_description(requirement)
        embedding_text = "\n".join(requirement.capabilities)
        raw_embedding = await self._embedding_client.embed(
            tenant_id=request.tenant_id,
            text=embedding_text,
        )
        embedding = embedding_vector_literal(raw_embedding)

        persona = {
            "capability_profile": requirement.model_dump(exclude_none=True),
            "persona_description": persona_description,
            "tier": "STANDARD",
        }
        persona_json = json.dumps(persona, separators=(",", ":"), sort_keys=True)

        tenant_uuid = _raw_uuid(request.tenant_id)
        workspace_uuid = _raw_uuid(request.workspace_id)
        agent_id = new_prefixed_id("agt")

        await self._session.execute(
            _SET_TENANT_CONTEXT,
            {"tenant_id": tenant_uuid},
        )
        await self._session.execute(
            _INSERT_AGENT,
            {
                "agent_id": agent_id,
                "tenant_id": tenant_uuid,
                "workspace_id": workspace_uuid,
                "name": f"Capability agent: {requirement.capabilities[0]}",
                "persona_description": persona_description,
            },
        )
        await self._session.execute(
            _INSERT_AGENT_VERSION,
            {
                "version_id": new_prefixed_id("agtv"),
                "agent_id": agent_id,
                "tenant_id": tenant_uuid,
                "config_json": persona_json,
            },
        )
        await self._session.execute(
            _INSERT_CAPABILITY_EMBEDDING,
            {
                "embedding_id": new_prefixed_id("cemb"),
                "agent_id": agent_id,
                "tenant_id": tenant_uuid,
                "capability_description": persona_description,
                "embedding": embedding,
                "embedding_metadata_json": json.dumps(
                    {"dimensions": 512, "source": "PLAN-8"},
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            },
        )

        return CreatePersonaResponse(
            agent_id=agent_id,
            agent_version=1,
            persona_json=persona_json,
        )


def _parse_capability_profile(raw_profile: str) -> NodeRequirement:
    try:
        return NodeRequirement.model_validate_json(raw_profile)
    except (ValidationError, ValueError) as error:
        raise PersonaCreationValidationError(
            "capability_profile_json must match NodeRequirement"
        ) from error


def _persona_description(requirement: NodeRequirement) -> str:
    capabilities = ", ".join(requirement.capabilities)
    return f"Specialist agent for capabilities: {capabilities}."


def _raw_uuid(prefixed_id: str) -> str:
    return prefixed_id.split("_", maxsplit=1)[1]
