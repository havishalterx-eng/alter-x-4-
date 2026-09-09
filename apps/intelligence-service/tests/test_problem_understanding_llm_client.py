"""Tests for the Problem Understanding Model Gateway boundary.

Every case here is a reply that arrived. Whether the gateway was reachable is
somebody else's test; these are about what this client does with an answer it
was given, which is where #139 lost the reason a ProblemSpec could not be
built.
"""

import json
from types import SimpleNamespace
from typing import Any

import pytest

from src.problem_understanding.llm_client import (
    ModelGatewayProblemUnderstandingClient,
    ProblemUnderstandingLlmError,
)

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"

_VALID_SPEC = {
    "objective": "summarize customer feedback",
    "current_situation": "no context supplied",
    "actors": [],
    "systems_involved": [],
    "constraints": [],
    "required_data": [],
    "risk": "unknown",
    "missing_information": [],
    "success_criteria": [],
}


class _ReplyStub:
    """Answers every Invoke with one fixed assistant message."""

    def __init__(self, content: str) -> None:
        self.content = content
        self.request: Any | None = None

    async def Invoke(self, request: object, **_kwargs: object) -> object:
        self.request = request
        return SimpleNamespace(
            output_json=json.dumps({"message": {"content": self.content}})
        )


def _client(stub: object) -> Any:
    client: Any = object.__new__(ModelGatewayProblemUnderstandingClient)
    client._stub = stub
    client._timeout_seconds = 30
    client._access_token_provider = None
    return client


async def _generate(content: str) -> Any:
    return await _client(_ReplyStub(content)).generate_problem_spec(
        tenant_id=TENANT_ID,
        run_id=RUN_ID,
        objective="summarize customer feedback",
        actor_context={},
        kb_context="",
    )


async def test_parses_a_bare_json_reply() -> None:
    spec = await _generate(json.dumps(_VALID_SPEC))

    assert spec.objective == "summarize customer feedback"
    assert spec.risk == "unknown"


async def test_recovers_a_reply_wrapped_in_a_markdown_fence() -> None:
    # What Amazon Nova actually returned for every ProblemSpec, and what made
    # the protobuf parser fail at character 0 with a message about the fence
    # rather than about the spec.
    fenced = "```json\n" + json.dumps(_VALID_SPEC, indent=2) + "\n```"

    spec = await _generate(fenced)

    assert spec.objective == "summarize customer feedback"


async def test_reports_which_field_was_wrong() -> None:
    # The failure that actually happened once the fence was handled: repeated
    # fields answered as scalars or objects. The message has to name the field,
    # because nothing downstream walks __cause__.
    wrong_types = {**_VALID_SPEC, "actors": {}, "systems_involved": ""}

    with pytest.raises(ProblemUnderstandingLlmError) as caught:
        await _generate(json.dumps(wrong_types))

    assert "actors" in str(caught.value)


async def test_reports_a_reply_that_is_not_json_at_all() -> None:
    with pytest.raises(ProblemUnderstandingLlmError) as caught:
        await _generate("I'm sorry, I can't help with that.")

    # Not the empty "returned an invalid ProblemSpec" sentence this used to be.
    assert str(caught.value) != "Model Gateway returned an invalid ProblemSpec"
    assert "ProblemSpec" in str(caught.value)


async def test_reports_an_unreadable_envelope_separately() -> None:
    class _NoMessage:
        async def Invoke(self, request: object, **_kwargs: object) -> object:
            del request
            return SimpleNamespace(output_json=json.dumps({"unexpected": True}))

    with pytest.raises(ProblemUnderstandingLlmError) as caught:
        await _client(_NoMessage()).generate_problem_spec(
            tenant_id=TENANT_ID,
            run_id=RUN_ID,
            objective="summarize customer feedback",
            actor_context={},
            kb_context="",
        )

    assert "envelope" in str(caught.value)
