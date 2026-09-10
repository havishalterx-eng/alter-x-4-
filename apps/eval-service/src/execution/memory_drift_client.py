"""Real client for tenant-isolation's memory_drift_observations case.

Targets memory-service's real, unmodified production FastAPI app
(src.main:app, run directly via uvicorn -- same shape as
policy_client.py's target). The real cross-tenant "empty_result" for
agent drift scores comes from drift_scores' own `drift_read` RLS policy
rather than from any app-level ownership check: since 0006 that policy
admits an agent row only when its `tenant_id` matches the session's
`app.current_tenant_id`.

Seeding writes as the real `policy_system_writer` role -- the only role
`drift_system_write` permits to INSERT -- under an owner tenant that is
not the eval tenant, then reads back as the eval tenant and gets
nothing.

Before 0006 the policy excluded every agent row from every session, so
this case passed for a reason that had nothing to do with tenancy: the
owning tenant saw the same empty result. It now demonstrates scoping.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2


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
        headers = {"Authorization": f"Bearer {service_token}"} if service_token else None
        super().__init__(base_url=base_url, timeout=timeout_seconds, headers=headers)
        self._system_db_url = system_db_url

    def seed_agent_drift_score(self) -> str:
        """Seed one agent drift row owned by a tenant that is not the reader.

        The row carries an owner because memory-service's 0006 requires one:
        an agent row with no tenant is a row nobody can read, which is the
        state this probe used to rely on. Owning it makes the case sharper
        rather than weaker -- the row is now readable by somebody, and the
        eval tenant still gets nothing, so the empty result demonstrates
        tenant scoping instead of a blanket exclusion of every agent row.
        """
        agent_id = f"agt_{_uuid7_shaped()}"
        drift_score_id = f"drift_{uuid.uuid4().hex}"
        owner_tenant_uuid = _uuid7_shaped()
        connection = psycopg2.connect(self._system_db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute(
                "INSERT INTO drift_scores "
                "(id, tenant_id, subject_type, subject_ref, task_class, score, "
                "baseline, action_taken) "
                "VALUES (%s, %s, 'agent', %s, 'eval-probe', 1.0, 0.0, 'flagged')",
                (drift_score_id, owner_tenant_uuid, agent_id),
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
