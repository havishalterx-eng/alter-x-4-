"""Pure requirement inference for compiled-but-unbound WorkflowDAG nodes.

This module deliberately performs no agent, embedding, performance, or database
lookup.  PLAN-7 consumes this output and owns selection/binding.
"""

import re
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import TypeAdapter, ValidationError

from src.capability_resolver.models import (
    AgentId,
    ModelAlias,
    NodeRequirement,
    NodeRequirements,
    NonEmptyString,
    PositiveInteger,
    ToolRequirement,
    WorkflowDagNode,
)

_CAPABILITIES_ADAPTER: TypeAdapter[list[str]] = TypeAdapter(list[NonEmptyString])
_TOOLS_ADAPTER: TypeAdapter[list[ToolRequirement]] = TypeAdapter(list[ToolRequirement])
_MODEL_ALIAS_ADAPTER: TypeAdapter[ModelAlias] = TypeAdapter(ModelAlias)
_AGENT_ID_ADAPTER: TypeAdapter[str] = TypeAdapter(AgentId)
_POSITIVE_INTEGER_ADAPTER: TypeAdapter[int] = TypeAdapter(PositiveInteger)

_DESCRIPTION_FIELDS = (
    "task_description",
    "description",
    "intent",
    "objective",
    "prompt_template",
    "prompt",
)

_LLM_CAPABILITY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("text.summarization", ("summarize", "summarise", "summary", "condense")),
    ("text.classification", ("classify", "categorize", "categorise", "label")),
    ("text.translation", ("translate", "translation", "localize", "localise")),
    (
        "information.extraction",
        ("extract", "parse", "structured data", "entities", "fields"),
    ),
    (
        "research.synthesis",
        ("research", "investigate", "sources", "evidence", "literature"),
    ),
    (
        "analysis.reasoning",
        ("analyze", "analyse", "analysis", "compare", "evaluate", "reason"),
    ),
    (
        "code.generation",
        ("code", "implement", "refactor", "debug", "software", "program"),
    ),
    (
        "task.planning",
        ("plan", "decompose", "architecture", "architect", "design"),
    ),
)

_ADVANCED_TIER_TERMS = (
    "architecture",
    "architect",
    "complex",
    "decompose",
    "multi-step",
    "research",
    "root cause",
    "strategy",
)
_FAST_TIER_TERMS = (
    "categorize",
    "categorise",
    "classify",
    "extract",
    "format",
    "label",
    "summarize",
    "summarise",
    "translate",
)

_NODE_BASE_CAPABILITIES: dict[str, tuple[str, ...]] = {
    "LLMTask": ("text.generation",),
    "SandboxExec": ("code.execution",),
    "Synthesis": ("content.synthesis",),
    "MemoryWrite": ("memory.extraction",),
}

_NODE_DEFAULT_MODEL_ALIAS: dict[str, ModelAlias] = {
    "LLMTask": "STANDARD",
    "Synthesis": "ADVANCED",
    "MemoryWrite": "STANDARD",
}


class CapabilityResolutionError(ValueError):
    """Raised when a node config cannot produce valid locked-contract output."""

    def __init__(self, node_key: str, message: str) -> None:
        super().__init__(f"node {node_key!r}: {message}")
        self.node_key = node_key


def resolve_node_requirements(
    nodes: Sequence[WorkflowDagNode | Mapping[str, Any]],
) -> NodeRequirements:
    """Resolve exactly one requirement record for every supplied DAG node."""

    if not nodes:
        raise CapabilityResolutionError("<dag>", "at least one node is required")

    requirements: dict[str, NodeRequirement] = {}
    for raw_node in nodes:
        node = _parse_node(raw_node)
        if node.key in requirements:
            raise CapabilityResolutionError(node.key, "duplicate node key")
        requirements[node.key] = _resolve_node(node)

    return NodeRequirements(root=requirements)


def _parse_node(raw_node: WorkflowDagNode | Mapping[str, Any]) -> WorkflowDagNode:
    if isinstance(raw_node, WorkflowDagNode):
        return raw_node
    return WorkflowDagNode.model_validate(raw_node)


def _resolve_node(node: WorkflowDagNode) -> NodeRequirement:
    description = _description(node.config)
    explicit_capabilities = _optional_config_value(node, "capabilities", _CAPABILITIES_ADAPTER)
    capabilities = _merge_unique(
        _derived_capabilities(node.type, description),
        explicit_capabilities or [],
    )

    model_alias = _model_alias(node, description)
    tools = _tool_requirements(node)
    preferred_agent_id = _optional_config_value(node, "preferred_agent_id", _AGENT_ID_ADAPTER)
    maximum_input_bytes = _optional_config_value(
        node, "maximum_input_bytes", _POSITIVE_INTEGER_ADAPTER
    )

    values: dict[str, object] = {"capabilities": capabilities}
    if model_alias is not None:
        values["model_alias"] = model_alias
    if tools is not None:
        values["tools"] = tools
    if preferred_agent_id is not None:
        values["preferred_agent_id"] = preferred_agent_id
    if maximum_input_bytes is not None:
        values["maximum_input_bytes"] = maximum_input_bytes

    return NodeRequirement.model_validate(values)


def _description(config: Mapping[str, Any]) -> str:
    parts = [
        value.strip()
        for field_name in _DESCRIPTION_FIELDS
        if isinstance((value := config.get(field_name)), str) and value.strip()
    ]
    return " ".join(parts)


def _derived_capabilities(node_type: str, description: str) -> list[str]:
    capabilities = list(_NODE_BASE_CAPABILITIES.get(node_type, ()))
    if node_type != "LLMTask":
        return capabilities

    lowered = description.casefold()
    for capability, terms in _LLM_CAPABILITY_RULES:
        if _contains_any(lowered, terms):
            capabilities.append(capability)
    return capabilities


def _model_alias(node: WorkflowDagNode, description: str) -> ModelAlias | None:
    default = _NODE_DEFAULT_MODEL_ALIAS.get(node.type)
    if default is None:
        return None

    configured = _optional_config_value(node, "model_alias", _MODEL_ALIAS_ADAPTER)
    if configured is not None:
        return configured

    complexity = node.config.get("complexity")
    if isinstance(complexity, str):
        normalized = complexity.strip().casefold()
        configured_by_complexity: dict[str, ModelAlias] = {
            "low": "FAST",
            "simple": "FAST",
            "standard": "STANDARD",
            "medium": "STANDARD",
            "advanced": "ADVANCED",
            "high": "ADVANCED",
            "ceiling": "CEILING",
            "ceiling-critical": "CEILING",
        }
        if normalized in configured_by_complexity:
            return configured_by_complexity[normalized]

    if node.type != "LLMTask":
        return default

    lowered = description.casefold()
    if _contains_any(lowered, _ADVANCED_TIER_TERMS):
        return "ADVANCED"
    if _contains_any(lowered, _FAST_TIER_TERMS):
        return "FAST"
    return default


def _tool_requirements(node: WorkflowDagNode) -> list[ToolRequirement] | None:
    configured_tools = _optional_config_value(node, "tools", _TOOLS_ADAPTER)
    configured_name = node.config.get("tool_name")

    if configured_tools is not None and configured_name is not None:
        raise CapabilityResolutionError(
            node.key,
            "use either tools or tool_name, not both",
        )

    if configured_tools is not None:
        if node.type == "ToolCall" and not configured_tools:
            raise CapabilityResolutionError(node.key, "ToolCall requires at least one tool")
        return configured_tools

    if node.type != "ToolCall":
        return None

    if configured_name is None:
        raise CapabilityResolutionError(node.key, "ToolCall requires tool_name or tools")

    tool_data: dict[str, object] = {
        "name": configured_name,
        "permissions": node.config.get("permissions", []),
    }
    if "tool_version" in node.config:
        tool_data["version"] = node.config["tool_version"]

    try:
        return [ToolRequirement.model_validate(tool_data)]
    except ValidationError as error:
        raise CapabilityResolutionError(node.key, "invalid ToolCall tool config") from error


def _optional_config_value[T](
    node: WorkflowDagNode,
    field_name: str,
    adapter: TypeAdapter[T],
) -> T | None:
    if field_name not in node.config:
        return None
    if node.config[field_name] is None:
        raise CapabilityResolutionError(
            node.key,
            f"{field_name} may be omitted but cannot be null",
        )
    try:
        return adapter.validate_python(node.config[field_name])
    except ValidationError as error:
        raise CapabilityResolutionError(node.key, f"invalid {field_name}") from error


def _contains_any(text: str, terms: tuple[str, ...]) -> bool:
    return any(
        re.search(rf"(?<![\w.]){re.escape(term)}(?![\w.])", text) is not None for term in terms
    )


def _merge_unique(*groups: Sequence[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for value in group:
            if value not in seen:
                merged.append(value)
                seen.add(value)
    return merged
