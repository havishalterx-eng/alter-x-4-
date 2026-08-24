"""Real client for HARD-7j (`workflow` golden-set domain, register_trigger
operation only).

Target is apps/orchestration-service/src/eval_trigger_registry_http_server.ts,
a real, disclosed eval-only entrypoint: the real, unmodified
TriggerRegistryController + TriggerRegistryService, with a synthetic
ActorContext injected in place of production's real JWT-backed
SessionGatewayGuard (no live signing keys/JWKS reachable here). The
registerTrigger business logic itself -- real DB write, real
workflowVersionId shape validation -- executes unmodified.

workflowVersionId has no real FK to any workflow_versions row (confirmed
by reading trigger-registry.service.ts's own disclosed comment: shape
validation only, "workflow_versions doesn't exist yet" as a real target
to bind against) -- only a real `workflows` row is needed.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx
import psycopg2

from src.execution.internal_auth import internal_service_auth_headers


@dataclass(frozen=True)
class RegisterTriggerResult:
    bound_to_version: bool


class TriggerRegistryClient(httpx.Client):
    def __init__(self, base_url: str, db_url: str, timeout_seconds: float = 30.0) -> None:
        super().__init__(
            base_url=base_url, timeout=timeout_seconds, headers=internal_service_auth_headers(),
        )
        self._db_url = db_url

    def _seed_workflow(self, *, tenant_uuid: str, workflow_id: str) -> None:
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("SET app.current_tenant_id = %s", (tenant_uuid,))
            cursor.execute(
                "INSERT INTO workflows (id, tenant_id, workspace_id, name, status) "
                "VALUES (%s, %s, %s, 'Eval Trigger Workflow', 'active') ON CONFLICT DO NOTHING",
                (workflow_id, tenant_uuid, tenant_uuid),
            )
            cursor.close()
        finally:
            connection.close()

    def register_trigger(
        self, *, tenant_uuid: str, workflow_id: str, name: str
    ) -> RegisterTriggerResult:
        self._seed_workflow(tenant_uuid=tenant_uuid, workflow_id=workflow_id)
        workflow_version_id = f"wfv_{_v7_shaped_uuid(f'eval-trigger-wfv/{uuid.uuid4()}')}"
        response = self.post(
            "/api/v1/triggers",
            json={
                "workspaceId": tenant_uuid,
                "workflowId": workflow_id,
                "name": name,
                "type": "manual",
                "workflowVersionId": workflow_version_id,
            },
        )
        response.raise_for_status()
        body = response.json()
        bound = body["triggerVersion"]["workflowVersionId"] is not None
        return RegisterTriggerResult(bound_to_version=bound)


def _v7_shaped_uuid(namespace_path: str) -> uuid.UUID:
    raw = uuid.uuid5(uuid.NAMESPACE_URL, namespace_path).hex
    shaped = f"{raw[0:12]}7{raw[13:16]}8{raw[17:32]}"
    return uuid.UUID(shaped)
