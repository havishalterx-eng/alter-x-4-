"""Real Model Gateway-backed LlmClient.

Implements only generate_skeleton() for real -- the typed ProblemSpec ->
TaskSkeleton path the Planner's default (non plan_then_execute,
non manager_worker) strategy uses. revise_skeleton/generate_manager_worker_plan
still defer to StubLlmClient's deterministic behavior; those are separate,
disclosed follow-ups, not part of this real path.

Same real gRPC-call pattern as verification-service's GrpcModelGatewayClient
(apps/verification-service/src/verification/model_gateway_client.py):
plain messages[] Invoke call against alter.modelgw.v1.ModelgwService, no
vendor SDK here -- the real Model Gateway adapter is the only thing that
ever names a concrete model.
"""

from __future__ import annotations

import json

import grpc

from alter.modelgw.v1 import modelgw_pb2, modelgw_pb2_grpc

from ..m2m_auth import AccessTokenProvider
from .llm_client import StubLlmClient
from .task_skeleton import TaskSkeleton

# CEILING is reserved (per llm_client.py) for the manager_worker path's
# "hardest decomposition"; the default single-shot skeleton call uses
# STANDARD.
_MODEL_ALIAS_SKELETON = "STANDARD"

_SKELETON_SYSTEM_PROMPT = """You are a task planner. Decompose the validated ProblemSpec JSON
into a task skeleton: a small DAG of steps needed to accomplish it.

Respond with a single JSON object only, no other text, no markdown code fences. The object \
must have this exact shape:
{
  "version": "1",
  "nodes": [
    {
      "key": "<unique_snake_case_id, must start with a letter>",
      "type": "<llm|tool|branch|join>",
      "config": { ... },
      "depends_on": ["<key of node this depends on>", ...]
    }
  ],
  "entry_point": "<key of the first node, must have depends_on: []>"
}

Rules for config, by node type:
- "llm": config must have "model_alias" (one of FAST, STANDARD, ADVANCED, CEILING -- use \
STANDARD unless the step clearly needs more reasoning) and "prompt" (a specific, self-\
contained instruction for that step). The model executing this step will be told to \
respond with JSON only, so the prompt should describe what fields the JSON output needs.
- "tool": config must have "tool_name" (a short, descriptive snake_case name for the \
external action, e.g. "youtube_upload", "video_render") and "arguments" (an object of \
whatever parameters that tool call needs).
- "branch" and "join": config can be an empty object {}.

Keep the plan small and concrete -- 2 to 6 nodes. Every node's dependencies must reference \
real node keys in the same skeleton. Exactly one node must have depends_on: [] and must \
match entry_point."""


class ModelGatewayLlmClient(StubLlmClient):
    """Real generate_skeleton(); everything else inherited from the stub."""

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
        self._stub = modelgw_pb2_grpc.ModelgwServiceStub(  # type: ignore[no-untyped-call]
            self._channel
        )
        self._timeout_seconds = timeout_seconds
        self._access_token_provider = access_token_provider

    async def close(self) -> None:
        if self._owns_channel:
            await self._channel.close()

    async def generate_skeleton(
        self,
        *,
        tenant_id: str,
        run_id: str,
        strategy: str,
        problem_spec_json: str,
    ) -> TaskSkeleton:
        payload = json.dumps(
            {
                "messages": [
                    {"role": "system", "content": _SKELETON_SYSTEM_PROMPT},
                    {"role": "user", "content": problem_spec_json},
                ],
                "temperature": 0.2,
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
                node_execution_id=f"planner_skeleton_{run_id}",
                model_alias=_MODEL_ALIAS_SKELETON,
                input_json=payload,
            ),
            **kwargs,
        )
        envelope = json.loads(response.output_json)
        content = envelope["message"]["content"]
        return TaskSkeleton.from_json(content)
