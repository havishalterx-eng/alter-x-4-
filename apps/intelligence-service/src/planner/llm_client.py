"""LLM client contract and stub for the planner kernel.

The planner calls the Model Gateway (alter.modelgw.v1.ModelgwService) for all
LLM inference.  The real gRPC client lives in packages/adapters (vendor-SDK
rule); this module defines only the Protocol the planner kernel depends on and
a contract-complete stub that returns deterministic responses.

Wire the stub during development.  Swap in the real adapter at integration
time without touching kernel.py.
"""

from typing import Protocol, runtime_checkable

from .task_skeleton import TaskNode, TaskSkeleton

_STUB_NODE_KEY = "node_stub_000"

_STUB_SINGLE_NODE_SKELETON = TaskSkeleton(
    version="1",
    nodes=[
        TaskNode(
            key=_STUB_NODE_KEY,
            type="llm",
            config={},
            depends_on=[],
        )
    ],
    entry_point=_STUB_NODE_KEY,
)


@runtime_checkable
class LlmClient(Protocol):
    """Narrow interface the planner kernel requires from the Model Gateway."""

    async def generate_skeleton(
        self,
        *,
        tenant_id: str,
        run_id: str,
        objective: str,
        strategy: str,
        kb_context: str,
    ) -> TaskSkeleton:
        """Decompose an objective into a task skeleton DAG."""
        ...

    async def revise_skeleton(
        self,
        *,
        tenant_id: str,
        run_id: str,
        current_skeleton: TaskSkeleton,
        failure_context_json: str,
    ) -> tuple[TaskSkeleton, str]:
        """Revise a skeleton given a failure context. Returns (skeleton, reason)."""
        ...


class StubLlmClient:
    """Contract-complete stub. Returns deterministic minimal skeletons.

    Used during development before the real Model Gateway adapter is wired.
    Never calls any external service.
    """

    async def generate_skeleton(
        self,
        *,
        tenant_id: str,
        run_id: str,
        objective: str,
        strategy: str,
        kb_context: str,
    ) -> TaskSkeleton:
        return _STUB_SINGLE_NODE_SKELETON

    async def revise_skeleton(
        self,
        *,
        tenant_id: str,
        run_id: str,
        current_skeleton: TaskSkeleton,
        failure_context_json: str,
    ) -> tuple[TaskSkeleton, str]:
        revised = TaskSkeleton(
            version=current_skeleton.version,
            nodes=current_skeleton.nodes,
            entry_point=current_skeleton.entry_point,
        )
        return revised, "Stub revision: no changes applied."
