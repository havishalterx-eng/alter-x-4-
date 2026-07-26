"""Unit tests for the ManagerWorker strategy skeleton builder."""

import pytest
from pydantic import ValidationError

from src.planner.manager_worker import (
    ManagerWorkerPlan,
    WorkerTaskSpec,
    build_manager_worker_skeleton,
)


def _plan(**overrides: object) -> ManagerWorkerPlan:
    defaults: dict[str, object] = {
        "manager_config": {"objective": "coordinate regional reports"},
        "workers": [
            WorkerTaskSpec(key="a", objective="part A", config={}),
            WorkerTaskSpec(key="b", objective="part B", config={}),
        ],
    }
    defaults.update(overrides)
    return ManagerWorkerPlan(**defaults)  # type: ignore[arg-type]


class TestManagerWorkerPlanValidation:
    def test_rejects_empty_workers_list(self) -> None:
        with pytest.raises(ValidationError):
            _plan(workers=[])


class TestBuildManagerWorkerSkeleton:
    def test_entry_point_is_manager_node(self) -> None:
        skeleton = build_manager_worker_skeleton(_plan())

        assert skeleton.entry_point == "node_manager"

    def test_worker_nodes_depend_only_on_manager(self) -> None:
        skeleton = build_manager_worker_skeleton(_plan())

        worker_nodes = [n for n in skeleton.nodes if n.key.startswith("node_worker_")]
        assert len(worker_nodes) == 2
        for node in worker_nodes:
            assert node.depends_on == ["node_manager"]

    def test_join_node_depends_on_all_workers(self) -> None:
        skeleton = build_manager_worker_skeleton(_plan())

        join_node = next(n for n in skeleton.nodes if n.key == "node_join")
        assert set(join_node.depends_on) == {"node_worker_a", "node_worker_b"}
        assert join_node.type == "join"

    def test_single_worker_plan_still_produces_valid_skeleton(self) -> None:
        plan = _plan(workers=[WorkerTaskSpec(key="only", objective="everything", config={})])
        skeleton = build_manager_worker_skeleton(plan)

        assert len(skeleton.nodes) == 3  # manager + 1 worker + join

    def test_worker_config_carries_objective(self) -> None:
        skeleton = build_manager_worker_skeleton(_plan())

        worker_a = next(n for n in skeleton.nodes if n.key == "node_worker_a")
        assert worker_a.config["objective"] == "part A"
