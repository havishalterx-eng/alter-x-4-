"""Real client for tenant-isolation's recovery_node_lookup and
run_stream_subscribe cases.

Targets apps/orchestration-service/src/eval_run_visibility_http_server.ts,
a real, disclosed eval-only entrypoint: NodeExecutionsController and
RunStreamController are real and unmodified, backed by real
NodeExecutionLedgerService/RunStreamEventService instances against a real
Postgres store. Both real cross-tenant checks are explicit, tenant-scoped
SQL (`WHERE tenant_id = $1 AND id = $2` / `runIsVisible`'s identical
query) -- defense in depth, not solely RLS-dependent -- so a real 404
RUN_NOT_FOUND is the correct, real outcome for a run that exists only
under a different tenant. The golden set's expected_json for both cases
was corrected from "denied" to "not_found" to match this real mechanism
(see apps/eval-service/src/db/remaining_golden_sets.py's own history --
the real backend here is a resource-visibility check, not an
authorization denial).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2

from src.execution.internal_auth import internal_service_auth_headers


@dataclass(frozen=True)
class RunVisibilityLookupResult:
    not_found: bool


class RunVisibilityEvalClient(httpx.Client):
    def __init__(self, base_url: str, db_url: str, timeout_seconds: float = 30.0) -> None:
        super().__init__(
            base_url=base_url, timeout=timeout_seconds, headers=internal_service_auth_headers(),
        )
        self._db_url = db_url

    def seed_cross_tenant_run(self, *, other_tenant_uuid: str) -> str:
        # Real RunIdSchema requires a UUIDv7-shaped body (version nibble
        # "7", variant nibble in 89ab) -- a plain uuid4() fails that real
        # validation with a 400, not the 404 this test needs.
        raw = uuid.uuid4().hex
        uuid_v7_shaped = f"{raw[0:8]}-{raw[8:12]}-7{raw[13:16]}-8{raw[17:20]}-{raw[20:32]}"
        run_id = f"run_{uuid_v7_shaped}"
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("SET app.current_tenant_id = %s", (other_tenant_uuid,))
            cursor.execute(
                "INSERT INTO runs (id, tenant_id, workspace_id, parent_kind, status) "
                "VALUES (%s, %s, %s, 'workflow', 'pending')",
                (run_id, other_tenant_uuid, other_tenant_uuid),
            )
            cursor.close()
        finally:
            connection.close()
        return run_id

    def check_node_executions(self, *, run_id: str) -> RunVisibilityLookupResult:
        """Caller tenant is fixed at server-boot time (EVAL_TENANT_ID) via
        the eval-only entrypoint's synthetic ActorContext -- there is no
        real per-request tenant header, same shape as every other
        single-tenant-fixed eval server in this campaign."""
        response = self.get(f"/api/v1/runs/{run_id}/node-executions")
        return RunVisibilityLookupResult(not_found=response.status_code == 404)

    def check_stream(self, *, run_id: str) -> RunVisibilityLookupResult:
        response = self.get(f"/api/v1/runs/{run_id}/stream")
        return RunVisibilityLookupResult(not_found=response.status_code == 404)
