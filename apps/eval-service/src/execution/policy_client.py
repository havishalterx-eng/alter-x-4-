"""Real client for tenant-isolation's policy_read case.

Targets memory-service's real, unmodified production FastAPI app
(src.main:app, run directly via uvicorn -- no eval-only entrypoint
needed, same shape as ingestion_client.py's ads-core target). The real
cross-tenant "empty_result" comes entirely from
SqlAlchemyPolicyStoreRepository.get_active_policy()'s own real,
RLS-scoped session (apps/memory-service/alembic/versions/
0001_create_policy_tables.py's `policies_read` policy: a tenant-scoped
policy row is invisible outside its own `app.current_tenant_id`).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass

import httpx
import psycopg2


@dataclass(frozen=True)
class ActivePolicyLookupResult:
    found: bool


class PolicyEvalClient(httpx.Client):
    def __init__(
        self,
        base_url: str,
        db_url: str,
        timeout_seconds: float = 30.0,
        *,
        service_token: str = "",
    ) -> None:
        headers = {"Authorization": f"Bearer {service_token}"} if service_token else None
        super().__init__(base_url=base_url, timeout=timeout_seconds, headers=headers)
        self._db_url = db_url

    def seed_cross_tenant_policy(self, *, other_tenant_uuid: str, kind: str) -> str:
        policy_id = f"pol_{uuid.uuid4().hex}"
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("SET app.current_tenant_id = %s", (other_tenant_uuid,))
            cursor.execute(
                "INSERT INTO policies (id, scope, scope_id, kind, version, body, status, source) "
                "VALUES (%s, 'tenant', %s, %s, 1, %s, 'active', 'human')",
                (policy_id, other_tenant_uuid, kind, json.dumps({"eval": True})),
            )
            cursor.close()
        finally:
            connection.close()
        return policy_id

    def check_active_policy(self, *, tenant_id: str, kind: str) -> ActivePolicyLookupResult:
        response = self.post(
            "/memory/active-policy",
            json={"tenant_id": tenant_id, "kind": kind},
        )
        response.raise_for_status()
        return ActivePolicyLookupResult(found=bool(response.json()["found"]))
