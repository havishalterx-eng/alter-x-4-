"""Real client for tenant-isolation's agent_selection_binding case.

Targets intelligence-service's real, unmodified production FastAPI app
(src.main:app, run directly via uvicorn) calling POST /selection-binding/
bind-agent-model-tool -> SelectionBindingEngine.bind()'s real
capability-similarity ranked-match path. This is the first tenant-isolation
case to exercise that path for real: it needed a real Python-to-
EmbeddingProvider transport, which didn't exist until GrpcEmbeddingClient
(see embedding_client.py's own module doc) closed that gap.

The real cross-tenant check is `_RANKED_AGENT_QUERY`'s own explicit
`WHERE a.tenant_id = :tenant_id AND ce.tenant_id = :tenant_id` (engine.py)
-- a tenant-a caller can never see tenant-b's seeded agent/
capability_embeddings row, regardless of capability-text similarity. Since
bind() now auto-creates a fresh agent for the caller's own tenant on a
genuine no-match (SelectionBindingEngine's persona_creation_engine wiring),
the observable terminal state is no longer NoAgentMatch -- it's a real
BindAgentModelToolResponse pointing at a brand-new tenant-a agent. The
isolation signal this check verifies is therefore not "did bind return a
no-match" but "is the agent_id bind() returned anything other than
tenant-b's seeded one" -- the thing that would actually indicate a leak.
A real, live model-gateway is needed (GrpcEmbeddingClient's embed() call
must succeed for the ranked-match path to even run) -- but only its
embedding provider, not its model provider, so the real production
main.ts run with ALTER_CONFIG_SOURCE=mock is sufficient
(createMockEmbeddingProvider is a real, deterministic, disclosed
non-production embedding, same shape as HARD-7c's retrieval golden set)
-- no live ANTHROPIC_API_KEY/OPENAI_API_KEY needed, unlike every other
live-model-gateway-dependent case in this campaign (model_gateway_cache,
intent, injection).
"""

from __future__ import annotations

import json
import uuid

import httpx
import psycopg2


def _uuid7_shaped() -> str:
    """Real TenantId/WorkspaceId/RunId (selection_binding/models.py)
    require a UUIDv7-shaped body (version nibble "7", variant nibble in
    89ab) -- a plain uuid.uuid4() fails that real Pydantic validation."""
    raw = uuid.uuid4().hex
    return f"{raw[0:8]}-{raw[8:12]}-7{raw[13:16]}-8{raw[17:20]}-{raw[20:32]}"


class AgentBindingEvalClient(httpx.Client):
    def __init__(self, base_url: str, db_url: str, timeout_seconds: float = 30.0) -> None:
        super().__init__(base_url=base_url, timeout=timeout_seconds)
        self._db_url = db_url

    def seed_cross_tenant_agent(self, *, other_tenant_uuid: str, workspace_uuid: str) -> str:
        agent_id = f"agt_{uuid.uuid4().hex}"
        agent_version_id = f"agtv_{uuid.uuid4().hex}"
        capability_embedding_id = f"cape_{uuid.uuid4().hex}"
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute(
                "INSERT INTO agents (id, tenant_id, workspace_id, name, tier, status) "
                "VALUES (%s, %s, %s, 'eval-probe agent', 'STANDARD', 'active')",
                (agent_id, other_tenant_uuid, workspace_uuid),
            )
            cursor.execute(
                "INSERT INTO agent_versions "
                "(id, agent_id, tenant_id, version_number, published_at) "
                "VALUES (%s, %s, %s, 1, now())",
                (agent_version_id, agent_id, other_tenant_uuid),
            )
            vector_literal = "[" + ",".join(["1.0"] + ["0.0"] * 511) + "]"
            cursor.execute(
                "INSERT INTO capability_embeddings "
                "(id, agent_id, tenant_id, capability_description, embedding) "
                "VALUES (%s, %s, %s, %s, %s::vector)",
                (
                    capability_embedding_id,
                    agent_id,
                    other_tenant_uuid,
                    "eval-probe capability",
                    vector_literal,
                ),
            )
            cursor.close()
        finally:
            connection.close()
        return agent_id

    def check_bind_is_tenant_isolated(
        self, *, tenant_id: str, workspace_id: str, seeded_agent_id: str
    ) -> bool:
        """Returns True when bind() never returned tenant-b's seeded
        agent_id to a tenant-a caller. bind() itself may now legitimately
        auto-create and return a brand-new tenant-a agent on a genuine
        no-match (SelectionBindingEngine's persona_creation_engine wiring)
        -- that's real isolation working correctly, not a leak. A leak
        would be `agent_id == seeded_agent_id`."""
        node_key = "node.eval-probe"
        requirement = {"capabilities": ["eval-probe capability"]}
        body = {
            "tenant_id": tenant_id,
            "run_id": f"run_{_uuid7_shaped()}",
            "node_key": node_key,
            "node_requirements_json": json.dumps({node_key: requirement}),
            "workspace_id": workspace_id,
            "node_type": "LLMTask",
            "task_category": "eval-probe",
        }
        response = self.post("/selection-binding/bind-agent-model-tool", json=body)
        response.raise_for_status()
        return bool(response.json().get("agent_id") != seeded_agent_id)
