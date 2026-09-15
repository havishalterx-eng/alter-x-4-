"""Real Model Gateway-backed LlmClient.

Every LlmClient operation is real here:

- generate_skeleton: ProblemSpec -> TaskSkeleton for direct/iterative work.
- classify_workflow_strategy: chooses a workflow objective's strategy.
- revise_skeleton: rewrites a skeleton around a failed node, for Recovery's
  replan strategy.
- generate_manager_worker_plan: splits an objective into a manager brief and
  independent parallel workers.

Model output is untrusted. Revised skeletons and manager/worker plans are
checked for what the compiler and node handlers will later require (see
_executable_problems and _manager_worker_plan), so a plan that cannot run
fails here with its reason rather than at compile or execution time.

Same real gRPC-call pattern as verification-service's GrpcModelGatewayClient
(apps/verification-service/src/verification/model_gateway_client.py):
plain messages[] Invoke call against alter.modelgw.v1.ModelgwService, no
vendor SDK here -- the real Model Gateway adapter is the only thing that
ever names a concrete model.
"""

from __future__ import annotations

import json
import re

import grpc

from alter.modelgw.v1 import modelgw_pb2, modelgw_pb2_grpc

from ..m2m_auth import AccessTokenProvider
from .llm_client import StubLlmClient
from .manager_worker import ManagerWorkerPlan, WorkerTaskSpec
from .task_skeleton import TaskSkeleton

# CEILING is reserved (per llm_client.py) for the manager_worker path's
# "hardest decomposition"; the default single-shot skeleton call uses
# STANDARD.
_MODEL_ALIAS_SKELETON = "STANDARD"

_SKELETON_SHAPE = """{
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
- "branch" and "join": config can be an empty object {}."""

_SKELETON_SYSTEM_PROMPT = f"""You are a task planner. Decompose the validated ProblemSpec JSON
into a task skeleton: a small DAG of steps needed to accomplish it.

Respond with a single JSON object only, no other text, no markdown code fences. The object \
must have this exact shape:
{_SKELETON_SHAPE}

Keep the plan small and concrete -- 2 to 6 nodes. Every node's dependencies must reference \
real node keys in the same skeleton. Exactly one node must have depends_on: [] and must \
match entry_point."""

# Replanning happens after something already failed on a plan good enough to
# compile, so it needs more judgement than drafting one.
_MODEL_ALIAS_REPLAN = "ADVANCED"

_REPLAN_SYSTEM_PROMPT = f"""You are a task planner repairing a plan after one of its steps \
failed. The user message is a JSON object with "current_skeleton" (the plan that ran), \
"failed_node_key" (the step that failed, when known) and "failure" (what the recovery \
system observed: failure class and root-cause estimate).

Produce a revised skeleton that removes the cause of the failure. Change what the failure \
points at -- for example rewrite the failed step's prompt or arguments, split it into \
smaller steps, add a step that gathers or checks what it was missing, or replace an \
approach that cannot work. Keep steps that did not contribute to the failure unchanged, \
with the same keys. Do not return the plan unchanged.

Respond with a single JSON object only, no other text, no markdown code fences:
{{"skeleton": <the revised skeleton>, "reason": "<one sentence: what changed and why>"}}

The revised skeleton must have this exact shape:
{_SKELETON_SHAPE}

Every node's dependencies must reference real node keys in the same skeleton. Exactly one \
node must have depends_on: [] and must match entry_point."""

# kernel.py passes CEILING for this call: deciding how to split an objective
# is the hardest decomposition the Planner does.
_MANAGER_WORKER_SYSTEM_PROMPT = """You are a task planner splitting one large objective into \
independent workstreams that run in parallel. The user message is a validated ProblemSpec \
JSON.

Plan one manager step and 2 to 8 worker steps:
- The manager runs first. Its prompt produces a shared brief that every worker receives: \
how the objective is divided, conventions and constraints all workers must follow, and \
what each worker's result must contain.
- Each worker owns exactly one workstream. Workers run at the same time and cannot see \
each other's results, so no worker may depend on another worker's output.

Respond with a single JSON object only, no other text, no markdown code fences:
{
  "manager": {"model_alias": "<FAST|STANDARD|ADVANCED|CEILING>", "prompt": "<instruction>"},
  "workers": [
    {
      "key": "<unique_snake_case_id, must start with a letter>",
      "objective": "<one sentence: the workstream this worker owns>",
      "model_alias": "<FAST|STANDARD|ADVANCED|CEILING>",
      "prompt": "<specific, self-contained instruction for this worker>"
    }
  ]
}

Use STANDARD unless a step clearly needs more reasoning. Every step's model will be told \
to respond with JSON only, so each prompt should describe the JSON fields its output needs."""

_MODEL_ALIASES = frozenset({"FAST", "STANDARD", "ADVANCED", "CEILING"})
# Same pattern the compiler enforces (compiler/dag-builder.ts).
_NODE_KEY_RE = re.compile(r"^[a-z][a-z0-9._-]{0,127}$", re.IGNORECASE)
_WORKER_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_MIN_WORKERS = 2
_MAX_WORKERS = 8

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
    """Every planner model call, through the Model Gateway."""

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
        content = await self._invoke(
            tenant_id=tenant_id,
            run_id=run_id,
            node_execution_id=f"planner_skeleton_{run_id}",
            model_alias=_MODEL_ALIAS_SKELETON,
            payload=_payload(_SKELETON_SYSTEM_PROMPT, problem_spec_json, temperature=0.2),
        )
        return TaskSkeleton.from_json(content)

    async def revise_skeleton(
        self,
        *,
        tenant_id: str,
        run_id: str,
        current_skeleton: TaskSkeleton,
        failure_context_json: str,
    ) -> tuple[TaskSkeleton, str]:
        failure = json.loads(failure_context_json)
        failed_node_key = failure.get("node_key") if isinstance(failure, dict) else None
        request = {
            "current_skeleton": current_skeleton.model_dump(),
            "failed_node_key": failed_node_key,
            "failure": failure,
        }
        content = await self._invoke(
            tenant_id=tenant_id,
            run_id=run_id,
            node_execution_id=f"planner_replan_{run_id}",
            model_alias=_MODEL_ALIAS_REPLAN,
            payload=_payload(_REPLAN_SYSTEM_PROMPT, json.dumps(request), temperature=0.2),
        )
        # strict=False: models put raw newlines inside long prompt strings.
        answer = json.loads(content, strict=False)
        revised = TaskSkeleton.model_validate(answer["skeleton"])
        problems = _executable_problems(revised)
        if problems:
            raise ValueError(f"revised skeleton is not executable: {'; '.join(problems)}")
        if revised == current_skeleton:
            # Recompiling the plan that just failed would only fail again.
            raise ValueError("revised skeleton is identical to the skeleton that failed")
        reason = str(answer.get("reason") or "").strip()
        return revised, reason or "Plan revised after a node failure."

    async def generate_manager_worker_plan(
        self,
        *,
        tenant_id: str,
        run_id: str,
        objective: str,
        kb_context: str,
        model_alias: str,
    ) -> ManagerWorkerPlan:
        content = await self._invoke(
            tenant_id=tenant_id,
            run_id=run_id,
            node_execution_id=f"planner_manager_worker_{run_id}",
            model_alias=model_alias,
            payload=_payload(_MANAGER_WORKER_SYSTEM_PROMPT, kb_context, temperature=0.2),
        )
        return _manager_worker_plan(json.loads(content, strict=False))

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


def _payload(system_prompt: str, user_content: str, *, temperature: float) -> str:
    return json.dumps(
        {
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": temperature,
        },
        separators=(",", ":"),
    )


def _llm_step_config(step: object, label: str) -> dict[str, object]:
    if not isinstance(step, dict):
        raise ValueError(f"{label} must be an object")
    alias = step.get("model_alias", "STANDARD")
    prompt = step.get("prompt")
    if alias not in _MODEL_ALIASES:
        raise ValueError(f"{label} has unknown model_alias {alias!r}")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError(f"{label} has no prompt")
    return {"model_alias": alias, "prompt": prompt}


def _manager_worker_plan(answer: object) -> ManagerWorkerPlan:
    """Validate a model's manager/worker answer into an executable plan.

    Every step becomes an LLMTask node, so each needs what LlmTaskHandler
    requires: a valid model_alias and a non-empty prompt.
    """
    if not isinstance(answer, dict):
        raise ValueError("manager_worker plan must be a JSON object")
    raw_workers = answer.get("workers")
    if not isinstance(raw_workers, list) or not _MIN_WORKERS <= len(raw_workers) <= _MAX_WORKERS:
        raise ValueError(f"manager_worker plan needs {_MIN_WORKERS} to {_MAX_WORKERS} workers")

    manager_config = _llm_step_config(answer.get("manager"), "manager")
    workers: list[WorkerTaskSpec] = []
    for index, raw in enumerate(raw_workers):
        label = f"worker {index}"
        config = _llm_step_config(raw, label)
        key = raw.get("key")
        objective = raw.get("objective")
        if not isinstance(key, str) or not _WORKER_KEY_RE.match(key):
            raise ValueError(f"{label} key {key!r} is not snake_case")
        if not isinstance(objective, str) or not objective.strip():
            raise ValueError(f"{label} has no objective")
        # Workers meet at a Merge node, which shallow-merges their outputs, so
        # two workers both answering {"summary": ...} would silently lose one.
        # Nesting each worker's result under its own key keeps every result.
        config["prompt"] = (
            f"{config['prompt']}\n\nRespond with a JSON object whose only top-level key is "
            f'"{key}", holding your result.'
        )
        workers.append(WorkerTaskSpec(key=key, objective=objective, config=config))

    keys = [worker.key for worker in workers]
    if len(set(keys)) != len(keys):
        raise ValueError("manager_worker plan has duplicate worker keys")
    return ManagerWorkerPlan(manager_config=manager_config, workers=workers)


def _executable_problems(skeleton: TaskSkeleton) -> list[str]:
    """What would stop this skeleton compiling or its nodes running.

    Mirrors compileTaskSkeletonToDag in
    apps/orchestration-service/src/compiler/dag-builder.ts and the LLMTask and
    ToolCall handlers' config requirements. Gate conditions are left to the
    compiler, which reports them precisely.
    """
    problems: list[str] = []
    nodes = {node.key: node for node in skeleton.nodes}
    if not skeleton.nodes:
        problems.append("no nodes")
    if len(nodes) != len(skeleton.nodes):
        problems.append("duplicate node keys")
    for node in skeleton.nodes:
        if not _NODE_KEY_RE.match(node.key):
            problems.append(f"node key {node.key!r} is invalid")
        if node.type not in {"llm", "tool", "branch", "join"}:
            problems.append(f"node {node.key!r} has unknown type {node.type!r}")
        problems.extend(
            f"node {node.key!r} depends on unknown node {dependency!r}"
            for dependency in node.depends_on
            if dependency not in nodes
        )
        if node.type == "llm":
            if node.config.get("model_alias") not in _MODEL_ALIASES:
                problems.append(f"llm node {node.key!r} has no valid model_alias")
            prompt = node.config.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                problems.append(f"llm node {node.key!r} has no prompt")
        if node.type == "tool":
            if not isinstance(node.config.get("tool_name"), str):
                problems.append(f"tool node {node.key!r} has no tool_name")
            if not isinstance(node.config.get("arguments"), dict):
                problems.append(f"tool node {node.key!r} has no arguments object")

    entry = nodes.get(skeleton.entry_point)
    if entry is None:
        problems.append(f"entry_point {skeleton.entry_point!r} is not a node")
    elif entry.depends_on:
        problems.append(f"entry_point {skeleton.entry_point!r} has dependencies")

    # Peel off nodes whose dependencies are all satisfied; anything left is a cycle.
    remaining = {key: {d for d in node.depends_on if d in nodes} for key, node in nodes.items()}
    while ready := [key for key, deps in remaining.items() if not deps]:
        for key in ready:
            del remaining[key]
        for deps in remaining.values():
            deps.difference_update(ready)
    if remaining:
        problems.append(f"dependency cycle among {sorted(remaining)}")
    return problems
