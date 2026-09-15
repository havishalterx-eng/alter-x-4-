"""Real Model Gateway-backed LlmClient.

Implements generate_skeleton() for real -- the typed ProblemSpec ->
TaskSkeleton path the Planner's default (non plan_then_execute,
non manager_worker) strategy uses -- and classify_workflow_strategy(), which
chooses a workflow objective's strategy. revise_skeleton and
generate_manager_worker_plan still defer to StubLlmClient's deterministic
behavior; those are separate, disclosed follow-ups, not part of this real path.

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


_MODEL_ALIAS_STRATEGY = "STANDARD"

# Written from the strategy definitions in strategies.py. It deliberately
# carries no example objectives: the planner golden set is the measure of
# this prompt, so wording copied from it would score the copy, not the model.
_STRATEGY_SYSTEM_PROMPT = """You decide how a workflow objective should be executed. \
Judge the work the objective actually requires, not how the request is worded: length, \
politeness, list formatting and particular verbs are not evidence either way.

Choose exactly one strategy:

- "direct": the whole objective is a single step. One action or one answer completes it, \
and there is no intermediate result that has to be checked before the work is done.

- "iterative": one line of work with several steps. Later steps depend on what earlier \
steps produce, or a result has to be checked before continuing -- for example finding a \
cause before acting on it, making a change and then confirming nothing broke, or \
repeating an adjustment until a goal is met. A list of steps that happen in order on the \
same piece of work is iterative, however many steps it names.

- "manager_worker": several substantial workstreams that are independent of each other \
and can run in parallel under one coordinator -- such as the same large job carried out \
separately for different teams, sites, markets or languages, or distinct large \
deliverables that do not wait on one another. The workstreams do not need to be listed \
individually; a count or a phrase covering many of them is enough when each one is a \
substantial job on its own.

If unsure between "direct" and "iterative", choose "iterative". Choose "manager_worker" \
only when the parallel, independent workstreams are clear.

Respond with a single JSON object only, no other text, no markdown code fences:
{"strategy": "<direct|iterative|manager_worker>", "reason": "<one sentence>"}"""

WORKFLOW_STRATEGIES = frozenset({"direct", "iterative", "manager_worker"})


def strategy_payload(objective: str) -> dict[str, object]:
    return {
        "messages": [
            {"role": "system", "content": _STRATEGY_SYSTEM_PROMPT},
            {"role": "user", "content": objective},
        ],
        "temperature": 0,
        "max_tokens": 200,
    }


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
        content = await self._invoke(
            tenant_id=tenant_id,
            run_id=run_id,
            node_execution_id=f"planner_skeleton_{run_id}",
            model_alias=_MODEL_ALIAS_SKELETON,
            payload=payload,
        )
        return TaskSkeleton.from_json(content)

    async def classify_workflow_strategy(
        self,
        *,
        tenant_id: str,
        run_id: str,
        objective: str,
    ) -> tuple[str, str]:
        content = await self._invoke(
            tenant_id=tenant_id,
            run_id=run_id,
            node_execution_id=f"planner_select_strategy_{run_id}",
            model_alias=_MODEL_ALIAS_STRATEGY,
            payload=json.dumps(strategy_payload(objective), separators=(",", ":")),
        )
        answer = json.loads(content)
        strategy = answer["strategy"]
        if strategy not in WORKFLOW_STRATEGIES:
            raise ValueError(f"model chose unknown workflow strategy {strategy!r}")
        return strategy, str(answer.get("reason") or "Chosen by model classification.")

    async def _invoke(
        self,
        *,
        tenant_id: str,
        run_id: str,
        node_execution_id: str,
        model_alias: str,
        payload: str,
    ) -> str:
        kwargs: dict[str, object] = {"timeout": self._timeout_seconds}
        if self._access_token_provider is not None:
            kwargs["metadata"] = self._access_token_provider.metadata()
        response = await self._stub.Invoke(
            modelgw_pb2.InvokeRequest(
                tenant_id=tenant_id,
                run_id=run_id,
                node_execution_id=node_execution_id,
                model_alias=model_alias,
                input_json=payload,
            ),
            **kwargs,
        )
        envelope = json.loads(response.output_json)
        return str(envelope["message"]["content"])
