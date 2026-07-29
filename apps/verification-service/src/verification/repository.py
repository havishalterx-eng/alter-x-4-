from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import VerificationContext

_SET_TENANT = text("SELECT set_config('app.current_tenant_id', :tenant_id, true)")
_LOAD_NODE = text(
    """
    SELECT ne.dag_node_id, ne.input_ref, ne.output_ref, wv.compiled_dag
      FROM node_executions ne
      JOIN runs r ON r.tenant_id = ne.tenant_id AND r.id = ne.run_id
      JOIN workflow_versions wv
        ON wv.tenant_id = r.tenant_id AND wv.id = r.workflow_version_id
     WHERE ne.tenant_id = :tenant_id
       AND ne.run_id = :run_id
       AND ne.id = :node_execution_id
    """
)
_LOAD_CHECKPOINTS = text(
    """
    SELECT context_key, value_json
      FROM blackboard_checkpoints
     WHERE tenant_id = :tenant_id
       AND run_id = :run_id
       AND context_key = ANY(:context_keys)
    """
)
_INSERT_RESULT = text(
    """
    INSERT INTO verification_results
      (id, tenant_id, run_id, node_execution_id, gate_type, verdict,
       score, threshold, reviewer_model, details)
    VALUES
      (:id, :tenant_id, :run_id, :node_execution_id, :gate_type, :verdict,
       :score, :threshold, 'FAST', CAST(:details AS jsonb))
    """
)


class VerificationDataError(RuntimeError):
    pass


class VerificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def set_tenant(self, tenant_uuid: str) -> None:
        await self._session.execute(_SET_TENANT, {"tenant_id": tenant_uuid})

    async def load_context(
        self,
        *,
        tenant_uuid: str,
        run_id: str,
        node_execution_id: str,
        response_node_ref: str,
        evidence_node_refs: Sequence[str],
    ) -> VerificationContext:
        result = await self._session.execute(
            _LOAD_NODE,
            {
                "tenant_id": tenant_uuid,
                "run_id": run_id,
                "node_execution_id": node_execution_id,
            },
        )
        row = result.mappings().one_or_none()
        if row is None:
            raise VerificationDataError("node execution was not found in the tenant run")
        if row["output_ref"] != response_node_ref:
            raise VerificationDataError("response node reference does not match node output_ref")

        allowed_evidence = {item for item in str(row["input_ref"] or "").split(",") if item}
        requested_evidence = set(evidence_node_refs) or allowed_evidence
        if not requested_evidence.issubset(allowed_evidence):
            raise VerificationDataError("evidence node reference is not an input to this node")

        refs = [response_node_ref, *sorted(requested_evidence)]
        checkpoints = await self._session.execute(
            _LOAD_CHECKPOINTS,
            {"tenant_id": tenant_uuid, "run_id": run_id, "context_keys": refs},
        )
        values = {str(item.context_key): item.value_json for item in checkpoints}
        if response_node_ref not in values:
            raise VerificationDataError("response node output is missing from durable Blackboard")
        missing = requested_evidence - values.keys()
        if missing:
            raise VerificationDataError("evidence node output is missing from durable Blackboard")

        task_context = _task_context(row["compiled_dag"], str(row["dag_node_id"]))
        return VerificationContext(
            task_context=task_context,
            response=values[response_node_ref],
            evidence={key: values[key] for key in sorted(requested_evidence)},
        )

    async def ensure_node(
        self,
        *,
        tenant_uuid: str,
        run_id: str,
        node_execution_id: str,
    ) -> None:
        result = await self._session.execute(
            _LOAD_NODE,
            {
                "tenant_id": tenant_uuid,
                "run_id": run_id,
                "node_execution_id": node_execution_id,
            },
        )
        if result.first() is None:
            raise VerificationDataError("node execution was not found in the tenant run")

    async def insert_result(self, values: dict[str, Any]) -> None:
        await self._session.execute(_INSERT_RESULT, values)


def _task_context(compiled_dag: object, node_key: str) -> dict[str, object]:
    if not isinstance(compiled_dag, dict):
        raise VerificationDataError("compiled DAG is unavailable")
    nodes = compiled_dag.get("nodes")
    if not isinstance(nodes, list):
        raise VerificationDataError("compiled DAG nodes are unavailable")
    for node in nodes:
        if isinstance(node, dict) and node.get("key") == node_key:
            return {
                "key": node_key,
                "type": node.get("type"),
                "config": node.get("config", {}),
            }
    raise VerificationDataError("node execution is absent from the compiled DAG")
