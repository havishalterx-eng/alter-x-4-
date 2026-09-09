"""Model Gateway boundary for LLM-backed problem understanding."""

from __future__ import annotations

import json
import logging
import re
from typing import Protocol, runtime_checkable

import grpc

from alter.modelgw.v1 import modelgw_pb2, modelgw_pb2_grpc

from ..m2m_auth import AccessTokenProvider
from .models import ProblemSpec, parse_problem_spec_json

_logger = logging.getLogger(__name__)

_MODEL_ALIAS = "STANDARD"

# The prompt names each key's type because ProblemSpec is parsed as protobuf
# with unknown fields rejected, and the previous version only listed the key
# names. Asked for "actors" with no further detail, a model answers `{}` or
# `""` as readily as `[]`, and one wrong type rejects the entire spec. Every
# repeated field was being answered as a scalar or an object (#139).
_SYSTEM_PROMPT = """Turn a user request and verified context into a ProblemSpec.

Return strict JSON only: no markdown fence, no prose before or after it.

Keys, with the exact type each must have:
  objective            string
  current_situation    string
  actors               array of strings
  systems_involved     array of strings
  constraints          array of strings
  required_data        array of strings
  risk                 string, a non-empty concise classification; write
                       "unknown" when the context does not support one, never
                       an empty string
  missing_information  array of strings
  success_criteria     array of strings

Every array must be a JSON array even when it is empty or holds one item.
Emit no key that is not listed above. Never invent facts missing from the
context; record each missing fact as a string in missing_information."""

# How much of an unusable reply to carry into the log. Enough to see what
# shape came back, short enough not to spill a full generation into it.
_LOGGED_REPLY_CHARS = 400


@runtime_checkable
class ProblemUnderstandingLlmClient(Protocol):
    async def generate_problem_spec(
        self,
        *,
        tenant_id: str,
        run_id: str,
        objective: str,
        actor_context: dict[str, str],
        kb_context: str,
    ) -> ProblemSpec: ...


class ModelGatewayProblemUnderstandingClient:
    """Real Model Gateway client; never calls a model provider directly."""

    def __init__(
        self,
        target: str,
        *,
        timeout_seconds: float = 30,
        channel: grpc.aio.Channel | None = None,
        access_token_provider: AccessTokenProvider | None = None,
    ) -> None:
        self._channel = channel or grpc.aio.insecure_channel(target)
        self._owns_channel = channel is None
        self._stub = modelgw_pb2_grpc.ModelgwServiceStub(self._channel)  # type: ignore[no-untyped-call]
        self._timeout_seconds = timeout_seconds
        self._access_token_provider = access_token_provider

    async def close(self) -> None:
        if self._owns_channel:
            await self._channel.close()

    async def generate_problem_spec(
        self,
        *,
        tenant_id: str,
        run_id: str,
        objective: str,
        actor_context: dict[str, str],
        kb_context: str,
    ) -> ProblemSpec:
        payload = json.dumps(
            {
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "objective": objective,
                                "actor_context": actor_context,
                                "verified_ads_context": kb_context,
                            },
                            separators=(",", ":"),
                        ),
                    },
                ],
                "temperature": 0.1,
            },
            separators=(",", ":"),
        )
        kwargs: dict[str, object] = {"timeout": self._timeout_seconds}
        if self._access_token_provider is not None:
            kwargs["metadata"] = self._access_token_provider.metadata()
        response = await self._stub.Invoke(
            modelgw_pb2.InvokeRequest(
                tenant_id=tenant_id,
                run_id=run_id,
                node_execution_id=f"problem_understanding_{run_id}",
                model_alias=_MODEL_ALIAS,
                input_json=payload,
            ),
            **kwargs,
        )
        try:
            envelope = json.loads(response.output_json)
            content = envelope["message"]["content"]
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ProblemUnderstandingLlmError(
                f"Model Gateway envelope is unreadable: {exc}"
            ) from exc

        try:
            return parse_problem_spec_json(_json_object_text(content))
        except (TypeError, ValueError) as exc:
            _logger.warning(
                "model reply is not a ProblemSpec (%s); first %d chars: %r",
                exc,
                _LOGGED_REPLY_CHARS,
                str(content)[:_LOGGED_REPLY_CHARS],
            )
            raise ProblemUnderstandingLlmError(
                f"Model Gateway returned an invalid ProblemSpec: {exc}"
            ) from exc


def _json_object_text(content: object) -> str:
    """Return the JSON object inside a model reply.

    Models told to answer in bare JSON routinely fence it anyway -- Amazon Nova
    wrapped every ProblemSpec in ```json ... ``` , and the protobuf parser fails
    at character 0 with a message about the fence rather than about the spec.
    Same recovery the prompt-injection classifier needed in #132.
    """
    text = str(content).strip()
    if text.startswith("```"):
        text = re.sub(r"^```[A-Za-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    return text


class ProblemUnderstandingLlmError(RuntimeError):
    """The real Model Gateway response cannot produce a valid ProblemSpec."""
