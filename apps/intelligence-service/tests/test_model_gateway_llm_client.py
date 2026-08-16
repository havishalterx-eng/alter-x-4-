"""Tests for the Model Gateway prompt boundary."""

import json
from types import SimpleNamespace
from typing import Any

from src.planner.model_gateway_llm_client import ModelGatewayLlmClient
from src.planner.task_skeleton import TaskNode, TaskSkeleton


class _RecordingStub:
    def __init__(self) -> None:
        self.request: Any | None = None

    async def Invoke(self, request: object, **_kwargs: object) -> object:
        self.request = request
        skeleton = TaskSkeleton(
            version="1",
            nodes=[TaskNode(key="plan", type="llm", config={}, depends_on=[])],
            entry_point="plan",
        )
        return SimpleNamespace(
            output_json=json.dumps({"message": {"content": skeleton.to_json()}})
        )


async def test_generate_skeleton_sends_canonical_problem_spec_json() -> None:
    stub = _RecordingStub()
    client: Any = object.__new__(ModelGatewayLlmClient)
    client._stub = stub
    client._timeout_seconds = 30
    client._access_token_provider = None
    problem_spec_json = json.dumps(
        {
            "objective": "summarize customer feedback",
            "current_situation": None,
            "actors": [],
            "systems_involved": [],
            "constraints": [],
            "required_data": [],
            "risk": "unknown",
            "missing_information": [],
            "success_criteria": [],
            "context_references": [],
        },
        separators=(",", ":"),
    )

    await client.generate_skeleton(
        tenant_id="ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
        run_id="run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
        strategy="iterative",
        problem_spec_json=problem_spec_json,
    )

    assert stub.request is not None
    payload = json.loads(stub.request.input_json)
    assert payload["messages"][1] == {"role": "user", "content": problem_spec_json}
