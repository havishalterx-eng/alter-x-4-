"""Real client for tenant-isolation's ads_get_ingestion_job case.

Targets ads-core's real, unmodified production FastAPI app (src.main:app,
run directly via uvicorn -- no eval-only entrypoint needed, unlike the
retrieval domain's eval_grpc_server.py which exists only to seed a
disclosed non-production embedding corpus). GET /ingestion/jobs/{id}'s
real cross-tenant "not_found" behavior comes entirely from
SqlAlchemyIngestionRepository's own real, RLS-scoped session
(apps/ads-core/src/ingestion/repository.py's `_set_tenant`), matching the
real `ingestion_jobs_tenant_context_isolation` RLS policy from
apps/ads-core/alembic/versions/0001_create_ads_core_tables.py.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2


@dataclass(frozen=True)
class IngestionJobLookupResult:
    not_found: bool


class IngestionEvalClient(httpx.Client):
    def __init__(self, base_url: str, db_url: str, timeout_seconds: float = 30.0) -> None:
        super().__init__(base_url=base_url, timeout=timeout_seconds)
        self._db_url = db_url

    def seed_cross_tenant_ingestion_job(self, *, other_tenant_uuid: str) -> str:
        scope_id = f"scp_{uuid.uuid4().hex}"
        source_id = f"src_{uuid.uuid4().hex}"
        job_id = f"job_{uuid.uuid4().hex}"
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("SET app.current_tenant_id = %s", (other_tenant_uuid,))
            cursor.execute(
                "INSERT INTO scopes (id, tenant_id, workspace_id) VALUES (%s, %s, %s)",
                (scope_id, other_tenant_uuid, str(uuid.uuid4())),
            )
            cursor.execute(
                "INSERT INTO sources (id, tenant_id, scope_id, kind) VALUES (%s, %s, %s, 'upload')",
                (source_id, other_tenant_uuid, scope_id),
            )
            cursor.execute(
                "INSERT INTO ingestion_jobs (id, tenant_id, source_id, stage) "
                "VALUES (%s, %s, %s, 'received')",
                (job_id, other_tenant_uuid, source_id),
            )
            cursor.close()
        finally:
            connection.close()
        return job_id

    def check_get(self, *, ingestion_job_id: str, tenant_id: str) -> IngestionJobLookupResult:
        response = super().get(
            f"/ingestion/jobs/{ingestion_job_id}",
            headers={"X-Alter-Tenant-Id": tenant_id},
        )
        return IngestionJobLookupResult(not_found=response.status_code == 404)
