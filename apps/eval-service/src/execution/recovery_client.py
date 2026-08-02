"""Real client for HARD-7i (`recovery` golden-set domain).

Target is apps/orchestration-service/src/eval_recovery_grpc_server.ts, a
real, disclosed eval-only entrypoint constructing RecoveryPolicyService
directly (not the full production app.module.ts monolith).

SelectStrategy's real production path only ever UPDATEs an existing
`recovery_actions` row -- that row is normally created by ClassifyFailure,
which makes a real, live ADVANCED-tier Model Gateway call. This client
bypasses that (same shortcut shape as ads-core's document seeding in
HARD-7c/7g) by seeding a real `recovery_actions` row directly via SQL,
along with the real `runs`/`node_executions` rows its FK constraints
require -- mirroring exactly what ClassifyFailure's own #persist would
have written, just without a live LLM call to get there.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass

import grpc
import psycopg2

from alter.recovery.v1 import recovery_pb2, recovery_pb2_grpc

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class SelectStrategyResult:
    strategy: str
    recovery_action_id: str


class RecoveryClient:
    def __init__(
        self, grpc_target: str, db_url: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS
    ) -> None:
        self._channel = grpc.insecure_channel(grpc_target)
        self._stub = recovery_pb2_grpc.RecoveryServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds
        self._db_url = db_url

    def _seed_pending_recovery_action(
        self, *, tenant_uuid: str, run_id: str, node_execution_id: str, failure_class: str
    ) -> None:
        recovery_action_id = f"rec_{uuid.uuid4()}"
        connection = psycopg2.connect(self._db_url)
        connection.autocommit = True
        try:
            cursor = connection.cursor()
            cursor.execute("SET app.current_tenant_id = %s", (tenant_uuid,))
            cursor.execute(
                "INSERT INTO runs (id, tenant_id, workspace_id, parent_kind, status) "
                "VALUES (%s, %s, %s, 'workflow', 'running') ON CONFLICT DO NOTHING",
                (run_id, tenant_uuid, tenant_uuid),
            )
            cursor.execute(
                "INSERT INTO node_executions "
                "(id, tenant_id, run_id, dag_node_id, node_type, attempt, status) "
                "VALUES (%s, %s, %s, 'node_a', 'llm', 1, 'failed') ON CONFLICT DO NOTHING",
                (node_execution_id, tenant_uuid, run_id),
            )
            cursor.execute(
                "INSERT INTO recovery_actions "
                "(id, tenant_id, run_id, node_execution_id, failure_class, "
                "strategy, policy_version) "
                "VALUES (%s, %s, %s, %s, %s, NULL, NULL) ON CONFLICT DO NOTHING",
                (recovery_action_id, tenant_uuid, run_id, node_execution_id, failure_class),
            )
            cursor.close()
        finally:
            connection.close()

    def select_strategy(
        self,
        *,
        tenant_id: str,
        tenant_uuid: str,
        run_id: str,
        node_execution_id: str,
        failure_class: str,
        node_attempt: int,
    ) -> SelectStrategyResult:
        self._seed_pending_recovery_action(
            tenant_uuid=tenant_uuid,
            run_id=run_id,
            node_execution_id=node_execution_id,
            failure_class=failure_class,
        )
        root_cause_estimate_json = json.dumps(
            {
                "schema_version": "heal5.v1",
                "failure_class": failure_class,
                "explanation": "eval harness seeded estimate",
                "confidence": 0.9,
                "evidence": ["seeded evidence"],
                "node_attempt": node_attempt,
                "model_alias": "ADVANCED",
                "resolved_capability": "ADVANCED:eval-harness",
            }
        )
        response = self._stub.SelectStrategy(
            recovery_pb2.SelectStrategyRequest(
                tenant_id=tenant_id,
                run_id=run_id,
                node_execution_id=node_execution_id,
                failure_class=failure_class,
                root_cause_estimate_json=root_cause_estimate_json,
            ),
            timeout=self._timeout_seconds,
        )
        return SelectStrategyResult(
            strategy=response.strategy, recovery_action_id=response.recovery_action_id
        )

    def close(self) -> None:
        self._channel.close()
