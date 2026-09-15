"""Tests for the Model Gateway prompt boundary."""

import json
from types import SimpleNamespace
from typing import Any

import pytest

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
        return SimpleNamespace(output_json=json.dumps({"message": {"content": skeleton.to_json()}}))


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


class _AnsweringStub:
    def __init__(self, content: str) -> None:
        self.content = content
        self.request: Any | None = None

    async def Invoke(self, request: object, **_kwargs: object) -> object:
        self.request = request
        return SimpleNamespace(output_json=json.dumps({"message": {"content": self.content}}))


def _client(stub: object) -> Any:
    client: Any = object.__new__(ModelGatewayLlmClient)
    client._stub = stub
    client._timeout_seconds = 30
    client._access_token_provider = None
    return client


async def test_classify_workflow_strategy_sends_objective_and_returns_model_choice() -> None:
    stub = _AnsweringStub(
        json.dumps({"strategy": "manager_worker", "reason": "Independent workstreams."})
    )

    strategy, reason = await _client(stub).classify_workflow_strategy(
        tenant_id="ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
        run_id="run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
        objective="Localize the app into four languages",
    )

    assert (strategy, reason) == ("manager_worker", "Independent workstreams.")
    assert stub.request is not None
    assert stub.request.model_alias == "STANDARD"
    assert stub.request.run_id == "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
    payload = json.loads(stub.request.input_json)
    assert payload["temperature"] == 0
    assert payload["messages"][1] == {
        "role": "user",
        "content": "Localize the app into four languages",
    }


async def test_classify_workflow_strategy_rejects_a_strategy_workflow_mode_cannot_use() -> None:
    # plan_then_execute is project-mode only; a model answering it for a
    # workflow objective is wrong, not a fifth option, so the kernel must
    # get an error and fall back rather than pass it through.
    stub = _AnsweringStub(json.dumps({"strategy": "plan_then_execute", "reason": "x"}))

    with pytest.raises(ValueError, match="unknown workflow strategy"):
        await _client(stub).classify_workflow_strategy(
            tenant_id="ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
            run_id="",
            objective="Fix a typo",
        )


async def test_classify_workflow_strategy_raises_on_non_json_answer() -> None:
    stub = _AnsweringStub("I think iterative is best.")

    with pytest.raises(json.JSONDecodeError):
        await _client(stub).classify_workflow_strategy(
            tenant_id="ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
            run_id="",
            objective="Fix a typo",
        )
