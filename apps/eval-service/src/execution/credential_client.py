"""Real client for tenant-isolation's platform_credential_get/delete cases
(follow-up to HARD-7g).

Target is apps/platform-api/src/eval_credential_http_server.ts, a real,
disclosed eval-only entrypoint: the real, unmodified CredentialController
+ CredentialService + CredentialRepository, with a synthetic ActorContext
injected in place of production's real JWT-backed RbacGuard (no live
signing keys/JWKS reachable here). The real cross-tenant "not_found"
behavior comes entirely from CredentialRepository's own real, tenant-
scoped SQL, untouched.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2

from src.execution.internal_auth import internal_service_auth_headers


@dataclass(frozen=True)
class CredentialLookupResult:
    not_found: bool


class CredentialEvalClient(httpx.Client):
    def __init__(self, base_url: str, db_url: str, timeout_seconds: float = 30.0) -> None:
        super().__init__(
            base_url=base_url, timeout=timeout_seconds, headers=internal_service_auth_headers(),
        )
        self._db_url = db_url

    def seed_cross_tenant_credential(self, *, other_tenant_uuid: str) -> str:
        """Seeds a real credential under a DIFFERENT tenant than the one
        the eval server's ActorContext is authenticated as -- the real
        cross-tenant probe."""
        credential_id = str(uuid.uuid4())
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute(
                "INSERT INTO tenants (id, name, status) VALUES (%s, 'Eval Tenant B', 'active') "
                "ON CONFLICT DO NOTHING",
                (other_tenant_uuid,),
            )
            cursor.execute("SET app.current_tenant_id = %s", (other_tenant_uuid,))
            cursor.execute(
                "INSERT INTO credential_refs (tenant_id, id, name, connector, scope, last4) "
                "VALUES (%s, %s, 'Eval Credential', 'postgres', 'deploy', '0000')",
                (other_tenant_uuid, credential_id),
            )
            cursor.close()
        finally:
            connection.close()
        return credential_id

    def check_get(self, *, credential_id: str) -> CredentialLookupResult:
        response = super().get(f"/api/v1/credentials/{credential_id}")
        return CredentialLookupResult(not_found=response.status_code == 404)

    def check_delete(self, *, credential_id: str) -> CredentialLookupResult:
        response = self.request(
            "DELETE",
            f"/api/v1/credentials/{credential_id}",
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        return CredentialLookupResult(not_found=response.status_code == 404)
