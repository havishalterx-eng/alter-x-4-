"""Unit tests for the Project strategy's fixed 14-stage build pipeline."""

from src.planner.project_strategy import PROJECT_STAGES, build_project_skeleton
from src.planner.task_skeleton import TaskSkeleton


class TestBuildProjectSkeleton:
    def test_has_exactly_fourteen_stages(self) -> None:
        assert len(PROJECT_STAGES) == 14

    def test_produces_fourteen_nodes(self) -> None:
        skeleton = build_project_skeleton(kb_context="")

        assert len(skeleton.nodes) == 14

    def test_entry_point_is_clarify_objective(self) -> None:
        skeleton = build_project_skeleton(kb_context="")

        assert skeleton.entry_point == "node_clarify_objective"

    def test_stages_are_chained_in_declared_order(self) -> None:
        skeleton = build_project_skeleton(kb_context="")

        expected_keys = [f"node_{key}" for key, _, _ in PROJECT_STAGES]
        actual_keys = [node.key for node in skeleton.nodes]
        assert actual_keys == expected_keys

        # Each node (after the first) depends only on its immediate predecessor.
        for i in range(1, len(skeleton.nodes)):
            assert skeleton.nodes[i].depends_on == [expected_keys[i - 1]]
        assert skeleton.nodes[0].depends_on == []

    def test_last_stage_is_deploy_production_and_monitor(self) -> None:
        skeleton = build_project_skeleton(kb_context="")

        assert skeleton.nodes[-1].key == "node_deploy_production_and_monitor"

    def test_plan_architecture_stage_carries_kb_context(self) -> None:
        skeleton = build_project_skeleton(kb_context='[{"document_id": "doc_x"}]')

        plan_node = next(n for n in skeleton.nodes if n.key == "node_plan_architecture")
        assert plan_node.config["kb_context"] == '[{"document_id": "doc_x"}]'

    def test_only_generative_stages_are_llm_type(self) -> None:
        skeleton = build_project_skeleton(kb_context="")

        llm_nodes = {n.key for n in skeleton.nodes if n.type == "llm"}
        assert llm_nodes == {"node_plan_architecture", "node_generate_code"}

    def test_result_round_trips_through_task_skeleton_json(self) -> None:
        skeleton = build_project_skeleton(kb_context="ctx")
        round_tripped = TaskSkeleton.from_json(skeleton.to_json())

        assert round_tripped == skeleton
