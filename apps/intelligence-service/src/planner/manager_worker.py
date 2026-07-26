"""ManagerWorker strategy: fan a large objective out to parallel worker agents.

Chosen (see strategies.py) when a Workflow-mode objective is large enough
that a single execution path (direct/iterative) can't reasonably cover it --
e.g. several independent large workstreams coordinated under one objective.
Deciding *how* to split the objective is the hardest decomposition the
Planner does, so it is the one call routed at the CEILING model tier (see
llm_client.py) rather than the kernel's default ADVANCED tier.

Skeleton shape: one manager node reasons about the split and owns
synthesis; each worker node executes one subtask in parallel, depending
only on the manager; a join node merges worker outputs before the run is
considered complete.
"""

from pydantic import BaseModel, Field

from .task_skeleton import TaskNode, TaskSkeleton

_MANAGER_NODE_KEY = "node_manager"
_JOIN_NODE_KEY = "node_join"


class WorkerTaskSpec(BaseModel):
    model_config = {"frozen": True}

    key: str
    objective: str
    config: dict[str, object] = Field(default_factory=dict)


class ManagerWorkerPlan(BaseModel):
    model_config = {"frozen": True}

    manager_config: dict[str, object] = Field(default_factory=dict)
    workers: list[WorkerTaskSpec] = Field(min_length=1)


def _worker_node_key(worker_key: str) -> str:
    return f"node_worker_{worker_key}"


def build_manager_worker_skeleton(plan: ManagerWorkerPlan) -> TaskSkeleton:
    worker_node_keys = [_worker_node_key(worker.key) for worker in plan.workers]

    nodes: list[TaskNode] = [
        TaskNode(
            key=_MANAGER_NODE_KEY,
            type="llm",
            config=plan.manager_config,
            depends_on=[],
        )
    ]
    nodes.extend(
        TaskNode(
            key=_worker_node_key(worker.key),
            type="llm",
            config={"objective": worker.objective, **worker.config},
            depends_on=[_MANAGER_NODE_KEY],
        )
        for worker in plan.workers
    )
    nodes.append(
        TaskNode(
            key=_JOIN_NODE_KEY,
            type="join",
            config={},
            depends_on=worker_node_keys,
        )
    )

    return TaskSkeleton(version="1", nodes=nodes, entry_point=_MANAGER_NODE_KEY)
