"""Real client for tenant-isolation's workflow_get and workflow_update cases.

Targets apps/orchestration-service/src/eval_workflow_read_http_server.ts, a
real, disclosed eval-only entrypoint: WorkflowReadController is real and
unmodified, backed by a real WorkflowReadService instance against a real
Postgres store. The real cross-tenant check is the `workflows` table's own
RLS policy (`workflows_tenant_context_isolation`,
apps/orchestration-service/drizzle/0000_create_workflows.sql) plus
WorkflowReadService's own explicit `WHERE tenant_id = $1 AND id = $2` --
defense in depth, matching the same shape as run_visibility_client.py. A
real 404 WORKFLOW_NOT_FOUND is the correct outcome for a workflow that
exists only under a different tenant, matching the golden set's own
"not_found" expected_json (never needed correcting -- this case was seeded
right the first time).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2

from src.execution.internal_auth import internal_service_auth_headers


@dataclass(frozen=True)
class WorkflowLookupResult:
    not_found: bool


class WorkflowEvalClient(httpx.Client):
    def __init__(self, base_url: str, db_url: str, timeout_seconds: float = 30.0) -> None:
        super().__init__(
            base_url=base_url, timeout=timeout_seconds, headers=internal_service_auth_headers(),
        )
        self._db_url = db_url

    def seed_cross_tenant_workflow(self, *, other_tenant_uuid: str) -> str:
        workflow_id = f"wf_{uuid.uuid4().hex}"
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("SET app.current_tenant_id = %s", (other_tenant_uuid,))
            cursor.execute(
                "INSERT INTO workflows (id, tenant_id, workspace_id, name, status) "
                "VALUES (%s, %s, %s, 'eval-probe', 'draft')",
                (workflow_id, other_tenant_uuid, other_tenant_uuid),
            )
            cursor.close()
        finally:
            connection.close()
        return workflow_id

    def check_get(self, *, workflow_id: str) -> WorkflowLookupResult:
        """Caller tenant is fixed at server-boot time (EVAL_TENANT_ID) via
        the eval-only entrypoint's synthetic ActorContext -- same shape as
        every other single-tenant-fixed eval server in this campaign."""
        response = self.get(f"/api/v1/workflows/{workflow_id}")
        return WorkflowLookupResult(not_found=response.status_code == 404)

    def check_update(self, *, workflow_id: str) -> WorkflowLookupResult:
        response = self.patch(f"/api/v1/workflows/{workflow_id}", json={"name": "hijacked"})
        return WorkflowLookupResult(not_found=response.status_code == 404)
