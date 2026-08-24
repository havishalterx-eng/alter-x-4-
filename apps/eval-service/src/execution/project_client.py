"""Real client for tenant-isolation's project_get and project_deploy cases.

Targets apps/orchestration-service/src/eval_project_read_http_server.ts, a
real, disclosed eval-only entrypoint: ProjectReadController is real and
unmodified, backed by a real ProjectReadService instance against a real
Postgres store. The real cross-tenant check is the `projects`/
`deployments` tables' own RLS policies
(apps/orchestration-service/drizzle/0019_create_projects.sql) plus
ProjectReadService's own explicit `WHERE tenant_id = $1 AND id = $2` --
defense in depth, matching the same shape as workflow_client.py. A real
404 PROJECT_NOT_FOUND is the correct outcome for a project that exists
only under a different tenant, matching the golden set's own "not_found"
expected_json (never needed correcting).

Unlike workflow_get/update, no prior schema existed anywhere for a
"project"/"deployment" resource on orchestration-service -- this case
needed 0019_create_projects.sql itself, not just a controller (see
project-read.service.ts's own module doc).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2

from src.execution.internal_auth import internal_service_auth_headers


@dataclass(frozen=True)
class ProjectLookupResult:
    not_found: bool


class ProjectEvalClient(httpx.Client):
    def __init__(self, base_url: str, db_url: str, timeout_seconds: float = 30.0) -> None:
        super().__init__(
            base_url=base_url, timeout=timeout_seconds, headers=internal_service_auth_headers(),
        )
        self._db_url = db_url

    def seed_cross_tenant_project(self, *, other_tenant_uuid: str) -> str:
        project_id = f"proj_{uuid.uuid4().hex}"
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("SET app.current_tenant_id = %s", (other_tenant_uuid,))
            cursor.execute(
                "INSERT INTO projects (id, tenant_id, workspace_id, name, status) "
                "VALUES (%s, %s, %s, 'eval-probe', 'draft')",
                (project_id, other_tenant_uuid, other_tenant_uuid),
            )
            cursor.close()
        finally:
            connection.close()
        return project_id

    def check_get(self, *, project_id: str) -> ProjectLookupResult:
        """Caller tenant is fixed at server-boot time (EVAL_TENANT_ID) via
        the eval-only entrypoint's synthetic ActorContext -- same shape as
        every other single-tenant-fixed eval server in this campaign."""
        response = self.get(f"/api/v1/projects/{project_id}")
        return ProjectLookupResult(not_found=response.status_code == 404)

    def check_deploy(self, *, project_id: str) -> ProjectLookupResult:
        response = self.post(f"/api/v1/projects/{project_id}/actions/deploy")
        return ProjectLookupResult(not_found=response.status_code == 404)
