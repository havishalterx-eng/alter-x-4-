"""Real client for tenant-isolation's memory_drift_observations case.

Targets memory-service's real, unmodified production FastAPI app
(src.main:app, run directly via uvicorn -- same shape as
policy_client.py's target). Unlike policy_read, the real cross-tenant
"empty_result" for agent drift scores does NOT come from a tenant_id
filter at all: drift_scores' own `drift_read` RLS policy
(apps/memory-service/alembic/versions/0001_create_policy_tables.py)
only permits SELECT of subject_type IN ('model','provider') rows --
agent-subject rows are deliberately default-deny for every tenant
session pending KNOW-15's local ownership projection, per that
migration's own docstring. Seeding writes as the real
`policy_system_writer` role (the only role drift_scores' own
`drift_system_write` policy permits to INSERT), then reads back as an
unrelated eval tenant -- the real RLS policy denies the row outright,
regardless of which tenant asks.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2

from src.execution.internal_auth import internal_service_auth_headers


def _uuid7_shaped() -> str:
    """Real _raw_id()/raw_uuid7() (DriftDetector) requires a
    UUIDv7-shaped body (version nibble "7", variant nibble in 89ab) --
    a plain uuid.uuid4() fails that real validation with a 422."""
    raw = uuid.uuid4().hex
    return f"{raw[0:8]}-{raw[8:12]}-7{raw[13:16]}-8{raw[17:20]}-{raw[20:32]}"


@dataclass(frozen=True)
class AgentDriftScoresLookupResult:
    empty: bool


class MemoryDriftEvalClient(httpx.Client):
    def __init__(
        self,
        base_url: str,
        system_db_url: str,
        timeout_seconds: float = 30.0,
        *,
        service_token: str = "",
    ) -> None:
        headers = internal_service_auth_headers()
        if service_token:
            headers["Authorization"] = f"Bearer {service_token}"
        super().__init__(base_url=base_url, timeout=timeout_seconds, headers=headers)
        self._system_db_url = system_db_url

    def seed_agent_drift_score(self) -> str:
        agent_id = f"agt_{_uuid7_shaped()}"
        drift_score_id = f"drift_{uuid.uuid4().hex}"
        connection = psycopg2.connect(self._system_db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute(
                "INSERT INTO drift_scores "
                "(id, subject_type, subject_ref, task_class, score, baseline, action_taken) "
                "VALUES (%s, 'agent', %s, 'eval-probe', 1.0, 0.0, 'flagged')",
                (drift_score_id, agent_id),
            )
            cursor.close()
        finally:
            connection.close()
        return agent_id

    def check_agent_scores(self, *, tenant_id: str, agent_id: str) -> AgentDriftScoresLookupResult:
        response = self.post(
            "/drift/agents/scores",
            json={"tenant_id": tenant_id, "agent_id": agent_id},
        )
        response.raise_for_status()
        return AgentDriftScoresLookupResult(empty=len(response.json()["scores"]) == 0)
