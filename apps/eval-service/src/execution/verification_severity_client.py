"""Real client for tenant-isolation's verification_score_node case.

Targets verification-service's real, unmodified production gRPC server
(src.grpc_server) -- no eval-only entrypoint needed, same shape as
ads_get_ingestion_job/policy_read. Unlike ScoreNodeInline (HARD-7a's
target, a pure stateless kernel with nothing to check ownership
against), AssessSeverity's real HallucinationVerificationEngine calls
VerificationRepository.ensure_node(), a real, explicit, tenant-scoped
`WHERE ne.tenant_id = :tenant_id AND ne.run_id = :run_id AND ne.id =
:node_execution_id` check (joined through runs/workflow_versions) --
this raises VerificationDataError -> a real 422 VERIFICATION_INPUT_
UNAVAILABLE for a node_execution that exists only under a different
tenant, entirely BEFORE the real ModelGatewayClient.assess_severity()
call ever happens, so no live LLM key is needed for this specific
cross-tenant check.

Seeds the real workflows -> workflow_versions -> runs -> node_executions
chain directly via SQL under tenant-b (verification-service reads
orchestration-service's own tables directly, confirmed by its
ORCHESTRATION_DATABASE_URL env var).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import grpc
import psycopg2

from alter.verify.v1 import verify_pb2, verify_pb2_grpc

DEFAULT_TIMEOUT_SECONDS = 30.0


def _uuid7_shaped() -> str:
    """Real RunIdSchema/NodeExecutionIdSchema require a UUIDv7-shaped
    body (version nibble "7", variant nibble in 89ab) -- a plain
    uuid.uuid4() fails that real validation with a 400."""
    raw = uuid.uuid4().hex
    return f"{raw[0:8]}-{raw[8:12]}-7{raw[13:16]}-8{raw[17:20]}-{raw[20:32]}"


@dataclass(frozen=True)
class AssessSeverityLookupResult:
    not_found: bool


class VerificationSeverityEvalClient:
    def __init__(
        self, target: str, db_url: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    ) -> None:
        self._channel = grpc.insecure_channel(target)
        self._stub = verify_pb2_grpc.VerifyServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds
        self._db_url = db_url

    def seed_cross_tenant_node(self, *, other_tenant_uuid: str) -> tuple[str, str]:
        workflow_id = f"wf_{uuid.uuid4()}"
        workflow_version_id = f"wfv_{uuid.uuid4()}"
        run_id = f"run_{_uuid7_shaped()}"
        node_execution_id = f"node_{_uuid7_shaped()}"
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("SET app.current_tenant_id = %s", (other_tenant_uuid,))
            cursor.execute(
                "INSERT INTO workflows (id, tenant_id, workspace_id, name) "
                "VALUES (%s, %s, %s, 'eval')",
                (workflow_id, other_tenant_uuid, str(uuid.uuid4())),
            )
            cursor.execute(
                "INSERT INTO workflow_versions "
                "(id, tenant_id, workflow_id, version, compiled_dag, dag_schema_version) "
                "VALUES (%s, %s, %s, 1, %s, 'v1')",
                (workflow_version_id, other_tenant_uuid, workflow_id, "{}"),
            )
            cursor.execute(
                "INSERT INTO runs "
                "(id, tenant_id, workspace_id, parent_kind, workflow_id, workflow_version_id) "
                "VALUES (%s, %s, %s, 'workflow', %s, %s)",
                (run_id, other_tenant_uuid, str(uuid.uuid4()), workflow_id, workflow_version_id),
            )
            cursor.execute(
                "INSERT INTO node_executions "
                "(id, tenant_id, run_id, dag_node_id, node_type, status) "
                "VALUES (%s, %s, %s, 'n1', 'llm_task', 'succeeded')",
                (node_execution_id, other_tenant_uuid, run_id),
            )
            cursor.close()
        finally:
            connection.close()
        return run_id, node_execution_id

    def check_assess_severity(
        self, *, tenant_id: str, run_id: str, node_execution_id: str
    ) -> AssessSeverityLookupResult:
        try:
            self._stub.AssessSeverity(
                verify_pb2.AssessSeverityRequest(
                    tenant_id=tenant_id,
                    run_id=run_id,
                    node_execution_id=node_execution_id,
                    finding_json="{}",
                ),
                timeout=self._timeout_seconds,
            )
            return AssessSeverityLookupResult(not_found=False)
        except grpc.RpcError as error:
            if error.code() in (grpc.StatusCode.NOT_FOUND, grpc.StatusCode.FAILED_PRECONDITION):
                return AssessSeverityLookupResult(not_found=True)
            raise

    def close(self) -> None:
        self._channel.close()
