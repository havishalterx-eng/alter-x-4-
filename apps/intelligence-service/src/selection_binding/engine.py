"""Tenant-safe, performance-weighted agent selection for PLAN-7."""

import json
import math
import uuid
from collections.abc import Sequence
from typing import TYPE_CHECKING, Protocol

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncSession

from src.capability_resolver import NodeRequirement, NodeRequirements
from src.selection_binding.embedding_client import EmbeddingClient
from src.selection_binding.models import (
    BindAgentModelToolRequest,
    BindAgentModelToolResponse,
    BindingContext,
    BindingOutcome,
    NoAgentMatch,
)
from src.selection_binding.policy_client import RoutingPolicyClient

if TYPE_CHECKING:
    from src.agent_auto_creation.models import CreatePersonaRequest, CreatePersonaResponse


class PersonaCreationEngine(Protocol):
    """Structural type for AgentAutoCreationEngine, avoiding a circular import
    (agent_auto_creation imports from selection_binding at module level)."""

    async def create_for_no_match(
        self, no_match: NoAgentMatch, request: "CreatePersonaRequest"
    ) -> "CreatePersonaResponse | NoAgentMatch": ...

_EMBEDDING_DIMENSIONS = 512

_SET_TENANT_CONTEXT = text(
    "SELECT set_config('app.current_tenant_id', :tenant_id, true)"
)

_PREFERRED_AGENT_QUERY = text(
    """
SELECT
  a.id AS agent_id,
  a.tier AS agent_tier,
  latest_version.version_number AS agent_version
FROM agents AS a
JOIN LATERAL (
  SELECT av.version_number
  FROM agent_versions AS av
  WHERE av.tenant_id = a.tenant_id
    AND av.agent_id = a.id
    AND av.published_at IS NOT NULL
  ORDER BY av.version_number DESC
  LIMIT 1
) AS latest_version ON TRUE
WHERE a.tenant_id = CAST(:tenant_id AS uuid)
  AND a.workspace_id = CAST(:workspace_id AS uuid)
  AND a.id = :preferred_agent_id
  AND a.status = 'active'
  AND (
    CAST(:required_tier AS text) IS NULL
    OR CASE a.tier
         WHEN 'FAST' THEN 1
         WHEN 'STANDARD' THEN 2
         WHEN 'ADVANCED' THEN 3
         WHEN 'CEILING' THEN 4
       END
       >= CASE CAST(:required_tier AS text)
            WHEN 'FAST' THEN 1
            WHEN 'STANDARD' THEN 2
            WHEN 'ADVANCED' THEN 3
            WHEN 'CEILING' THEN 4
          END
  )
LIMIT 1
"""
)

_RANKED_AGENT_QUERY = text(
    """
WITH performance AS (
  SELECT
    pr.agent_id,
    AVG(
      CASE pr.verdict
        WHEN 'success' THEN 1.0
        WHEN 'partial' THEN 0.5
        WHEN 'failure' THEN 0.0
        WHEN 'escalated' THEN 0.0
      END
    )::double precision AS performance_score
  FROM performance_records AS pr
  WHERE pr.tenant_id = CAST(:tenant_id AS uuid)
    AND pr.node_type = :node_type
    AND (
      CAST(:task_category AS text) IS NULL
      OR pr.task_category = CAST(:task_category AS text)
    )
  GROUP BY pr.agent_id
), candidate_similarity AS (
  SELECT
    a.id AS agent_id,
    a.tier AS agent_tier,
    latest_version.version_number AS agent_version,
    MAX(
      1.0 - (ce.embedding <=> CAST(:query_embedding AS vector(512)))
    )::double precision AS capability_similarity,
    COALESCE(performance.performance_score, 0.5) AS performance_score
  FROM agents AS a
  JOIN capability_embeddings AS ce
    ON ce.tenant_id = a.tenant_id
   AND ce.agent_id = a.id
  JOIN LATERAL (
    SELECT av.version_number
    FROM agent_versions AS av
    WHERE av.tenant_id = a.tenant_id
      AND av.agent_id = a.id
      AND av.published_at IS NOT NULL
    ORDER BY av.version_number DESC
    LIMIT 1
  ) AS latest_version ON TRUE
  LEFT JOIN performance ON performance.agent_id = a.id
  WHERE a.tenant_id = CAST(:tenant_id AS uuid)
    AND ce.tenant_id = CAST(:tenant_id AS uuid)
    AND a.workspace_id = CAST(:workspace_id AS uuid)
    AND a.status = 'active'
    AND (
      CAST(:required_tier AS text) IS NULL
      OR CASE a.tier
           WHEN 'FAST' THEN 1
           WHEN 'STANDARD' THEN 2
           WHEN 'ADVANCED' THEN 3
           WHEN 'CEILING' THEN 4
         END
         >= CASE CAST(:required_tier AS text)
              WHEN 'FAST' THEN 1
              WHEN 'STANDARD' THEN 2
              WHEN 'ADVANCED' THEN 3
              WHEN 'CEILING' THEN 4
            END
    )
  GROUP BY
    a.id,
    a.tier,
    latest_version.version_number,
    performance.performance_score
), ranked AS (
  SELECT
    agent_id,
    agent_tier,
    agent_version,
    capability_similarity,
    performance_score,
    (
      :similarity_weight * capability_similarity
      + :performance_weight * performance_score
    ) AS combined_score
  FROM candidate_similarity
  WHERE capability_similarity >= :minimum_capability_similarity
)
SELECT
  agent_id,
  agent_tier,
  agent_version,
  capability_similarity,
  performance_score,
  combined_score
FROM ranked
WHERE combined_score >= :minimum_combined_score
ORDER BY combined_score DESC, capability_similarity DESC, agent_id ASC
LIMIT 1
"""
)


class BindingValidationError(ValueError):
    pass


class EmbeddingResultError(ValueError):
    pass


class SelectionBindingEngine:
    """Bind one PLAN-6 requirement record to one eligible published agent."""

    def __init__(
        self,
        session: AsyncSession,
        embedding_client: EmbeddingClient,
        *,
        similarity_weight: float = 0.8,
        minimum_capability_similarity: float = 0.6,
        minimum_combined_score: float = 0.7,
        policy_client: RoutingPolicyClient | None = None,
        persona_creation_engine: PersonaCreationEngine | None = None,
    ) -> None:
        if not 0.0 <= similarity_weight <= 1.0:
            raise ValueError("similarity_weight must be between 0 and 1")
        if not 0.0 <= minimum_capability_similarity <= 1.0:
            raise ValueError("minimum_capability_similarity must be between 0 and 1")
        if not 0.0 <= minimum_combined_score <= 1.0:
            raise ValueError("minimum_combined_score must be between 0 and 1")

        self._session = session
        self._embedding_client = embedding_client
        self._similarity_weight = similarity_weight
        self._performance_weight = 1.0 - similarity_weight
        self._minimum_capability_similarity = minimum_capability_similarity
        self._minimum_combined_score = minimum_combined_score
        self._policy_client = policy_client
        self._persona_creation_engine = persona_creation_engine

    async def bind(
        self,
        request: BindAgentModelToolRequest,
        context: BindingContext,
    ) -> BindingOutcome:
        requirement = _requirement_for_node(request)
        tenant_uuid = _database_uuid(request.tenant_id, "ten")
        workspace_uuid = _database_uuid(context.workspace_id, "ws")

        await self._session.execute(
            _SET_TENANT_CONTEXT,
            {"tenant_id": tenant_uuid},
        )

        if requirement.preferred_agent_id is not None:
            return await self._bind_preferred(
                request=request,
                requirement=requirement,
                tenant_uuid=tenant_uuid,
                workspace_uuid=workspace_uuid,
            )

        if not requirement.capabilities:
            return NoAgentMatch(
                node_key=request.node_key,
                reason="agent_not_required",
            )

        raw_embedding = await self._embedding_client.embed(
            tenant_id=request.tenant_id,
            text="\n".join(requirement.capabilities),
        )
        query_embedding = embedding_vector_literal(raw_embedding)
        similarity_weight = await self._load_similarity_weight(request.tenant_id)
        result = await self._session.execute(
            _RANKED_AGENT_QUERY,
            {
                "tenant_id": tenant_uuid,
                "workspace_id": workspace_uuid,
                "required_tier": requirement.model_alias,
                "node_type": context.node_type,
                "task_category": context.task_category,
                "query_embedding": query_embedding,
                "similarity_weight": similarity_weight,
                "performance_weight": 1.0 - similarity_weight,
                "minimum_capability_similarity": self._minimum_capability_similarity,
                "minimum_combined_score": self._minimum_combined_score,
            },
        )
        candidate = result.mappings().first()
        if candidate is None:
            no_match = NoAgentMatch(
                node_key=request.node_key,
                reason="no_eligible_agent",
            )
            if self._persona_creation_engine is None:
                return no_match
            return await self._create_and_bind(
                no_match=no_match,
                request=request,
                context=context,
                requirement=requirement,
            )

        return _response(candidate, requirement)

    async def _create_and_bind(
        self,
        *,
        no_match: NoAgentMatch,
        request: BindAgentModelToolRequest,
        context: BindingContext,
        requirement: NodeRequirement,
    ) -> BindingOutcome:
        from src.agent_auto_creation.models import CreatePersonaRequest

        assert self._persona_creation_engine is not None
        persona_request = CreatePersonaRequest(
            tenant_id=request.tenant_id,
            workspace_id=context.workspace_id,
            capability_profile_json=requirement.model_dump_json(exclude_none=True),
        )
        outcome = await self._persona_creation_engine.create_for_no_match(
            no_match, persona_request
        )
        if isinstance(outcome, NoAgentMatch):
            return outcome
        return BindAgentModelToolResponse(
            agent_id=outcome.agent_id,
            agent_version=outcome.agent_version,
            model_alias=requirement.model_alias or "STANDARD",
            tool_names=[tool.name for tool in requirement.tools or []],
        )

    async def _load_similarity_weight(self, tenant_id: str) -> float:
        if self._policy_client is None:
            return self._similarity_weight
        try:
            weight = await self._policy_client.similarity_weight(tenant_id)
        except Exception:
            return self._similarity_weight
        return self._similarity_weight if weight is None else weight

    async def _bind_preferred(
        self,
        *,
        request: BindAgentModelToolRequest,
        requirement: NodeRequirement,
        tenant_uuid: str,
        workspace_uuid: str,
    ) -> BindingOutcome:
        result = await self._session.execute(
            _PREFERRED_AGENT_QUERY,
            {
                "tenant_id": tenant_uuid,
                "workspace_id": workspace_uuid,
                "preferred_agent_id": requirement.preferred_agent_id,
                "required_tier": requirement.model_alias,
            },
        )
        candidate = result.mappings().first()
        if candidate is None:
            return NoAgentMatch(
                node_key=request.node_key,
                reason="preferred_agent_unavailable",
            )
        return _response(candidate, requirement)


def _requirement_for_node(request: BindAgentModelToolRequest) -> NodeRequirement:
    try:
        requirements = NodeRequirements.model_validate_json(
            request.node_requirements_json
        )
    except (json.JSONDecodeError, ValidationError, ValueError) as error:
        raise BindingValidationError(
            "node_requirements_json must match NodeRequirements"
        ) from error

    requirement = requirements.root.get(request.node_key)
    if requirement is None:
        raise BindingValidationError(
            f"node_requirements_json has no entry for node_key={request.node_key}"
        )
    return requirement


def _database_uuid(prefixed_id: str, expected_prefix: str) -> str:
    prefix, raw_uuid = prefixed_id.split("_", maxsplit=1)
    if prefix.casefold() != expected_prefix:
        raise BindingValidationError(f"expected {expected_prefix}_ prefixed identifier")
    try:
        return str(uuid.UUID(raw_uuid))
    except ValueError as error:
        raise BindingValidationError("identifier does not contain a valid UUID") from error


def embedding_vector_literal(values: Sequence[float]) -> str:
    vector = list(values)
    if len(vector) != _EMBEDDING_DIMENSIONS:
        raise EmbeddingResultError(
            f"embedding must contain exactly {_EMBEDDING_DIMENSIONS} values"
        )
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        for value in vector
    ):
        raise EmbeddingResultError("embedding values must be finite numbers")
    if not any(value != 0 for value in vector):
        raise EmbeddingResultError("embedding must not be the zero vector")
    return "[" + ",".join(str(float(value)) for value in vector) + "]"


def _response(
    candidate: RowMapping,
    requirement: NodeRequirement,
) -> BindAgentModelToolResponse:
    return BindAgentModelToolResponse.model_validate(
        {
            "agent_id": candidate["agent_id"],
            "agent_version": candidate["agent_version"],
            "model_alias": requirement.model_alias or candidate["agent_tier"],
            "tool_names": [tool.name for tool in requirement.tools or []],
        }
    )
