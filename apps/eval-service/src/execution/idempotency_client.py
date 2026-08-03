"""Real client for tenant-isolation's idempotency_replay case.

Targets two instances of apps/platform-api/src/eval_credential_http_server.ts
(the same real, disclosed eval-only entrypoint HARD-7g's platform_credential
follow-up already uses), one per tenant, sharing one real Postgres so both
hit the same real, tenant-scoped idempotency_keys table
(apps/platform-api/src/idempotency/idempotency-store.ts's real
`WHERE tenant_id = $1 AND idempotency_key = $2` lookup). The real property
under test: tenant-b reusing the exact same Idempotency-Key tenant-a already
used must never be short-circuited by tenant-a's cached record -- it must
execute as a genuinely new, isolated request.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2


@dataclass(frozen=True)
class IdempotencyReplayResult:
    isolated: bool


class IdempotencyReplayClient:
    def __init__(
        self,
        *,
        tenant_a_base_url: str,
        tenant_b_base_url: str,
        db_url: str,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._tenant_a = httpx.Client(base_url=tenant_a_base_url, timeout=timeout_seconds)
        self._tenant_b = httpx.Client(base_url=tenant_b_base_url, timeout=timeout_seconds)
        self._db_url = db_url

    def _seed_credential(self, *, tenant_uuid: str) -> str:
        credential_id = str(uuid.uuid4())
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute(
                "INSERT INTO tenants (id, name, status) VALUES (%s, 'Eval Tenant', 'active') "
                "ON CONFLICT DO NOTHING",
                (tenant_uuid,),
            )
            cursor.execute("SET app.current_tenant_id = %s", (tenant_uuid,))
            cursor.execute(
                "INSERT INTO credential_refs (tenant_id, id, name, connector, scope, last4) "
                "VALUES (%s, %s, 'Eval Credential', 'postgres', 'deploy', '0000')",
                (tenant_uuid, credential_id),
            )
            cursor.close()
        finally:
            connection.close()
        return credential_id

    def check_isolated(self, *, tenant_a_uuid: str, tenant_b_uuid: str) -> IdempotencyReplayResult:
        idempotency_key = str(uuid.uuid4())
        credential_a = self._seed_credential(tenant_uuid=tenant_a_uuid)
        credential_b = self._seed_credential(tenant_uuid=tenant_b_uuid)

        self._tenant_a.request(
            "DELETE",
            f"/api/v1/credentials/{credential_a}",
            headers={"Idempotency-Key": idempotency_key},
        )
        self._tenant_b.request(
            "DELETE",
            f"/api/v1/credentials/{credential_b}",
            headers={"Idempotency-Key": idempotency_key},
        )

        # Real proof tenant-b's delete actually executed (not short-circuited
        # by tenant-a's idempotency record for the same key): tenant-b's own
        # credential must now be really gone.
        follow_up = self._tenant_b.get(f"/api/v1/credentials/{credential_b}")
        return IdempotencyReplayResult(isolated=follow_up.status_code == 404)

    def close(self) -> None:
        self._tenant_a.close()
        self._tenant_b.close()
