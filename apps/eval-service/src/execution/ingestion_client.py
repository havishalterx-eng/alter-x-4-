"""Real client for tenant-isolation's ads_get_ingestion_job and
ads_upload_download cases.

Both real routes live under ingestion/router.py's own
`APIRouter(prefix="/ads", ...)` -- every request path below is prefixed
`/ads/...` accordingly. (check_get previously called the unprefixed
`/ingestion/jobs/{id}` path, which 404s unconditionally regardless of
the real cross-tenant logic since the route simply does not exist there
-- this happened to coincide with the expected "not_found" outcome, so
the case appeared to pass without ever exercising
SqlAlchemyIngestionRepository's real RLS-scoped lookup. Fixed alongside
ads_upload_download since both share this file.)

Targets ads-core's real, unmodified production FastAPI app (src.main:app,
run directly via uvicorn -- no eval-only entrypoint needed, unlike the
retrieval domain's eval_grpc_server.py which exists only to seed a
disclosed non-production embedding corpus). GET /ingestion/jobs/{id}'s
real cross-tenant "not_found" behavior comes entirely from
SqlAlchemyIngestionRepository's own real, RLS-scoped session
(apps/ads-core/src/ingestion/repository.py's `_set_tenant`), matching the
real `ingestion_jobs_tenant_context_isolation` RLS policy from
apps/ads-core/alembic/versions/0001_create_ads_core_tables.py.

POST /ingestion/uploads/complete's real cross-tenant behavior is a real,
explicit 403 FORBIDDEN ("upload_key does not belong to the requesting
tenant") -- router.py's own `if not body.upload_key.startswith(
f"tenants/{bare_tenant}/uploads/")` check, evaluated before any object
storage or DB call. Golden set's expected_json was corrected from
"not_found" to "denied" to match this real mechanism (opposite direction
from every other HARD-7g vocabulary fix so far: here the real backend IS
an explicit authorization denial, not a resource-visibility check). No
real S3 bucket is needed for this check to be exercised -- it runs before
`head_object` is ever called, and ads-core's own `_build_object_storage`
falls back to a real (disclosed non-S3) InMemoryObjectStorageProvider
when no bucket is configured, same Protocol either way.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2


@dataclass(frozen=True)
class IngestionJobLookupResult:
    not_found: bool


@dataclass(frozen=True)
class UploadCompleteResult:
    denied: bool


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
            f"/ads/ingestion/jobs/{ingestion_job_id}",
            headers={"X-Alter-Tenant-Id": tenant_id},
        )
        return IngestionJobLookupResult(not_found=response.status_code == 404)

    def check_complete_upload_cross_tenant(
        self, *, caller_tenant_id: str, other_tenant_uuid: str
    ) -> UploadCompleteResult:
        upload_key = f"tenants/{other_tenant_uuid}/uploads/{uuid.uuid4().hex}"
        response = super().post(
            "/ads/ingestion/uploads/complete",
            json={
                "ingestion_job_id": f"ing_{uuid.uuid4().hex}",
                "source_id": f"src_{uuid.uuid4().hex}",
                "upload_key": upload_key,
            },
            headers={"X-Alter-Tenant-Id": caller_tenant_id},
        )
        return UploadCompleteResult(denied=response.status_code == 403)
