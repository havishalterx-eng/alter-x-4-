from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import cast

import pytest

from src.memory_learning.extraction import (
    MemoryLearningKernel,
    MemoryLearningValidationError,
)
from src.memory_learning.models import (
    ProposeWritebackRequest,
    RunLearningSummary,
)
from src.memory_learning.repository import StoredCandidate

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ac"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ad"
ARTIFACT_ID = "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ae"


def request() -> ProposeWritebackRequest:
    return ProposeWritebackRequest(
        tenant_id=TENANT_ID,
        workspace_id=WORKSPACE_ID,
        run_id=RUN_ID,
        verified_output_artifact_id=ARTIFACT_ID,
        namespace="project/learning",
    )


def summary(
    *,
    verdict: str = "failed",
    workspace_id: str = WORKSPACE_ID,
    tenant_id: str = TENANT_ID,
    failure_class: str | None = "tool_permission_denial",
    failed_node_status: str = "failed",
) -> RunLearningSummary:
    return RunLearningSummary.model_validate(
        {
            "tenant_id": tenant_id,
            "run_id": RUN_ID,
            "workspace_id": workspace_id,
            "verdict": verdict,
            "gates_passed": 2,
            "gates_failed": 1,
            "recovery_count": 2 if failure_class is not None else 0,
            "nodes": [
                {
                    "node_execution_id": "node_a",
                    "node_key": "research",
                    "node_type": "LLMTask",
                    "status": "succeeded",
                    "attempt": 1,
                    "input_ref": None,
                    "output_ref": "research",
                    "error_code": None,
                },
                {
                    "node_execution_id": "node_b",
                    "node_key": "publish",
                    "node_type": "ToolCall",
                    "status": failed_node_status,
                    "attempt": 3,
                    "input_ref": "research",
                    "output_ref": None,
                    "error_code": "TOOL_PERMISSION_DENIED",
                },
            ],
            "recovery_actions": (
                [
                    {
                        "node_execution_id": "node_b",
                        "failure_class": failure_class,
                        "strategy": "ask_user",
                        "outcome": "escalated",
                    }
                ]
                if failure_class is not None
                else []
            ),
        }
    )


class FakeOrchestrationClient:
    def __init__(self, result: RunLearningSummary) -> None:
        self.result = result
        self.calls: list[dict[str, str]] = []

    async def load_summary(
        self,
        *,
        tenant_id: str,
        run_id: str,
        authorization: str,
    ) -> RunLearningSummary:
        self.calls.append(
            {
                "tenant_id": tenant_id,
                "run_id": run_id,
                "authorization": authorization,
            }
        )
        return self.result


@dataclass
class FakeRepository:
    call: dict[str, object] | None = None

    def propose(self, **values: object) -> StoredCandidate:
        self.call = values
        return StoredCandidate(
            memory_id=str(values["memory_id"]),
            content=cast(dict[str, object], values["content"]),
        )


def test_extracts_real_failure_data_and_writes_candidate() -> None:
    orchestration = FakeOrchestrationClient(summary())
    repository = FakeRepository()
    response = asyncio.run(
        MemoryLearningKernel(orchestration, repository).propose_writeback(
            request(), "Bearer tenant-service-token"
        )
    )

    assert response.memory_id.startswith("mem_")
    candidate = json.loads(response.candidate_json)
    assert candidate["final_verdict"] == "failed"
    assert candidate["recovery_count"] == 2
    assert candidate["failed_nodes"] == [
        {
            "attempt": 3,
            "error_code": "TOOL_PERMISSION_DENIED",
            "node_execution_id": "node_b",
            "node_key": "publish",
            "node_type": "ToolCall",
            "status": "failed",
        }
    ]
    assert candidate["recovery_actions"][0]["strategy"] == "ask_user"
    assert repository.call is not None
    assert repository.call["tenant_uuid"] == TENANT_ID.removeprefix("ten_")
    assert repository.call["scope"] == "failure"
    assert repository.call["provenance"] == {
        "run_id": RUN_ID,
        "workspace_id": WORKSPACE_ID,
        "verified_output_artifact_id": ARTIFACT_ID,
        "namespace": "project/learning",
        "source_summary": (
            "verdict=failed; failed_nodes=1; recovery_count=2; strategies=ask_user"
        ),
    }
    assert orchestration.calls == [
        {
            "tenant_id": TENANT_ID,
            "run_id": RUN_ID,
            "authorization": "Bearer tenant-service-token",
        }
    ]


@pytest.mark.parametrize("verdict", ["completed_verified", "rescued"])
def test_successful_outcomes_without_safety_signal_use_project_scope(
    verdict: str,
) -> None:
    repository = FakeRepository()
    asyncio.run(
        MemoryLearningKernel(
            FakeOrchestrationClient(summary(verdict=verdict, failure_class=None)),
            repository,
        ).propose_writeback(request(), "Bearer token")
    )
    assert repository.call is not None
    assert repository.call["scope"] == "project"


def test_safety_violation_takes_precedence_over_rescued_verdict() -> None:
    repository = FakeRepository()
    asyncio.run(
        MemoryLearningKernel(
            FakeOrchestrationClient(
                summary(verdict="rescued", failure_class="safety_violation")
            ),
            repository,
        ).propose_writeback(request(), "Bearer token")
    )
    assert repository.call is not None
    assert repository.call["scope"] == "safety_pattern"


def test_blocked_node_without_safety_violation_remains_failure() -> None:
    repository = FakeRepository()
    asyncio.run(
        MemoryLearningKernel(
            FakeOrchestrationClient(
                summary(
                    verdict="failed",
                    failure_class=None,
                    failed_node_status="blocked_pending_recovery",
                )
            ),
            repository,
        ).propose_writeback(request(), "Bearer token")
    )
    assert repository.call is not None
    assert repository.call["scope"] == "failure"


def test_rejects_cross_workspace_summary_before_write() -> None:
    repository = FakeRepository()
    with pytest.raises(MemoryLearningValidationError, match="requested workspace"):
        asyncio.run(
            MemoryLearningKernel(
                FakeOrchestrationClient(
                    summary(
                        workspace_id="ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ff"
                    )
                ),
                repository,
            ).propose_writeback(request(), "Bearer token")
        )
    assert repository.call is None


def test_rejects_bearer_tenant_mismatch_before_write() -> None:
    repository = FakeRepository()
    with pytest.raises(MemoryLearningValidationError, match="tenant"):
        asyncio.run(
            MemoryLearningKernel(
                FakeOrchestrationClient(
                    summary(
                        tenant_id="ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ff"
                    )
                ),
                repository,
            ).propose_writeback(request(), "Bearer token-for-other-tenant")
        )
    assert repository.call is None


def test_requires_bearer_before_cross_service_call() -> None:
    orchestration = FakeOrchestrationClient(summary())
    with pytest.raises(MemoryLearningValidationError, match="bearer"):
        asyncio.run(
            MemoryLearningKernel(orchestration, FakeRepository()).propose_writeback(
                request(), "not-bearer"
            )
        )
    assert orchestration.calls == []
