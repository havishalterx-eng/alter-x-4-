"""Project strategy: the fixed 14-stage build pipeline for mode="project".

Unlike the Workflow strategy (see strategies.py), Project-mode decomposition
is not objective-dependent at the skeleton-shape level -- every Project-mode
build runs the same ordered pipeline (plan, generate, verify, deploy, in that
order), regardless of what is being built. What varies per objective is the
*content* each stage's LLM/tool call produces at execution time, not the
pipeline shape itself. So this module is deterministic: no ADS/LLM call is
needed to decide the skeleton structure.

Each stage maps to a real Engine component from doc 13 sec 2, not an
invented name -- see the `component` field on each PROJECT_STAGES entry.
"""

from .task_skeleton import TaskNode, TaskSkeleton

# (stage_key, node_type, owning_component)
# node_type is one of the four TaskNode types already established by PLAN-3
# (llm | tool | branch | join) -- see task_skeleton.py. "llm" is used only
# for the two genuinely generative stages (architecture planning, code
# generation); every other stage is a "tool" call into the owning component.
PROJECT_STAGES: list[tuple[str, str, str]] = [
    ("clarify_objective", "tool", "ClarificationLoop"),
    ("scaffold", "tool", "Provisioning"),
    ("plan_architecture", "llm", "Planner"),
    ("generate_code", "llm", "Executor"),
    ("install_dependencies", "tool", "SandboxService"),
    ("lint_autofix", "tool", "SandboxService"),
    ("static_security_scan", "tool", "VerificationQualityGate"),
    ("unit_test", "tool", "SandboxService"),
    ("build_verify", "tool", "SandboxService"),
    ("render_verify", "tool", "SandboxService"),
    ("human_review_gate", "tool", "HumanActionCentre"),
    ("deploy_preview", "tool", "WorkflowLifecycle"),
    ("acceptance_verify", "tool", "VerificationQualityGate"),
    ("deploy_production_and_monitor", "tool", "WorkflowLifecycle"),
]

_STAGE_COUNT = 14
if len(PROJECT_STAGES) != _STAGE_COUNT:
    raise AssertionError(f"PROJECT_STAGES must have exactly {_STAGE_COUNT} stages")


def _node_key(stage_key: str) -> str:
    return f"node_{stage_key}"


def build_project_skeleton(kb_context: str) -> TaskSkeleton:
    """Build the fixed 14-stage Project-mode TaskSkeleton.

    kb_context is attached only to the plan_architecture stage's config,
    since that is the only stage whose content generation benefits from
    retrieved knowledge -- every other stage's behavior is fixed by the
    pipeline itself.
    """
    nodes: list[TaskNode] = []
    previous_key: str | None = None

    for index, (stage_key, node_type, component) in enumerate(PROJECT_STAGES, start=1):
        config: dict[str, object] = {"component": component, "stage_index": index}
        if stage_key == "plan_architecture":
            config["kb_context"] = kb_context

        nodes.append(
            TaskNode(
                key=_node_key(stage_key),
                type=node_type,
                config=config,
                depends_on=[_node_key(previous_key)] if previous_key else [],
            )
        )
        previous_key = stage_key

    return TaskSkeleton(
        version="1",
        nodes=nodes,
        entry_point=_node_key(PROJECT_STAGES[0][0]),
    )
