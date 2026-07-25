from typing import Any, cast

import pytest
from pydantic import ValidationError

from src.capability_resolver import (
    CapabilityResolutionError,
    NodeRequirement,
    NodeRequirements,
    ToolRequirement,
    WorkflowDagNode,
    resolve_node_requirements,
)

VALID_AGENT_ID = "agt_018f47a5-7b2c-7d10-8f11-123456789abc"


def node(
    key: str,
    node_type: str,
    config: dict[str, Any] | None = None,
    *,
    ui: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "type": node_type,
        "config": config or {},
        "metadata": {"ui": ui or {}, "label": f"UI label for {key}"},
    }


def dumped(requirements: NodeRequirements) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        requirements.model_dump(mode="json", exclude_none=True),
    )


class TestContractModels:
    def test_node_requirement_serializes_only_locked_contract_fields(self) -> None:
        requirement = NodeRequirement(
            capabilities=[" text.generation "],
            model_alias="STANDARD",
            tools=[
                ToolRequirement(
                    name=" search.web ",
                    version=" v1 ",
                    permissions=[" web:read "],
                )
            ],
            preferred_agent_id=VALID_AGENT_ID,
            maximum_input_bytes=16_384,
        )

        assert requirement.model_dump(exclude_none=True) == {
            "capabilities": ["text.generation"],
            "model_alias": "STANDARD",
            "tools": [
                {
                    "name": "search.web",
                    "version": "v1",
                    "permissions": ["web:read"],
                }
            ],
            "preferred_agent_id": VALID_AGENT_ID,
            "maximum_input_bytes": 16_384,
        }

    def test_optional_fields_are_omitted_and_explicit_null_is_rejected(self) -> None:
        requirement = NodeRequirement(capabilities=[])
        assert requirement.model_dump(exclude_none=True) == {"capabilities": []}

        with pytest.raises(ValidationError):
            NodeRequirement(capabilities=[], model_alias=None)
        with pytest.raises(ValidationError):
            ToolRequirement(name="search.web", permissions=[], version=None)

    @pytest.mark.parametrize("alias", ["FAST", "STANDARD", "ADVANCED", "CEILING"])
    def test_accepts_exact_model_alias_ladder(self, alias: str) -> None:
        requirement = NodeRequirement.model_validate({"capabilities": [], "model_alias": alias})
        assert requirement.model_alias == alias

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("model_alias", "ULTRA"),
            ("preferred_agent_id", "agent-not-v7"),
            ("maximum_input_bytes", 0),
            ("maximum_input_bytes", True),
            ("capabilities", ["  "]),
        ],
    )
    def test_rejects_values_rejected_by_typescript_contract(
        self, field: str, value: object
    ) -> None:
        with pytest.raises(ValidationError):
            NodeRequirement.model_validate({"capabilities": [], field: value})

    def test_rejects_extra_requirement_and_tool_fields(self) -> None:
        with pytest.raises(ValidationError):
            NodeRequirement.model_validate({"capabilities": [], "invented": True})
        with pytest.raises(ValidationError):
            ToolRequirement.model_validate(
                {"name": "search.web", "permissions": [], "invented": True}
            )

    def test_node_requirements_enforces_real_node_key_shape(self) -> None:
        NodeRequirements.model_validate({"valid.key-1": {"capabilities": []}})

        with pytest.raises(ValidationError):
            NodeRequirements.model_validate({"not a node key": {"capabilities": []}})


class TestResolution:
    def test_resolves_all_eleven_node_types_exactly_once(self) -> None:
        nodes = [
            node(
                "llm",
                "LLMTask",
                {"intent": "Research and compare evidence for a migration plan"},
            ),
            node(
                "tool",
                "ToolCall",
                {
                    "tool_name": "search.web",
                    "tool_version": "v1",
                    "permissions": ["web:read"],
                },
            ),
            node("sandbox", "SandboxExec", {"maximum_input_bytes": 65_536}),
            node("gate", "Gate"),
            node("approval", "HumanApproval"),
            node("merge", "Merge"),
            node("synthesis", "Synthesis"),
            node("memory", "MemoryWrite"),
            node("pubsub", "PubSub"),
            node("group", "GroupChat"),
            node("yaml", "YAMLImport"),
        ]

        result = dumped(resolve_node_requirements(nodes))

        assert list(result) == [item["key"] for item in nodes]
        assert result == {
            "llm": {
                "capabilities": [
                    "text.generation",
                    "research.synthesis",
                    "analysis.reasoning",
                    "task.planning",
                ],
                "model_alias": "ADVANCED",
            },
            "tool": {
                "capabilities": [],
                "tools": [
                    {
                        "name": "search.web",
                        "version": "v1",
                        "permissions": ["web:read"],
                    }
                ],
            },
            "sandbox": {
                "capabilities": ["code.execution"],
                "maximum_input_bytes": 65_536,
            },
            "gate": {"capabilities": []},
            "approval": {"capabilities": []},
            "merge": {"capabilities": []},
            "synthesis": {
                "capabilities": ["content.synthesis"],
                "model_alias": "ADVANCED",
            },
            "memory": {
                "capabilities": ["memory.extraction"],
                "model_alias": "STANDARD",
            },
            "pubsub": {"capabilities": []},
            "group": {"capabilities": []},
            "yaml": {"capabilities": []},
        }

    def test_llm_task_derives_fast_tier_and_semantic_capabilities(self) -> None:
        result = dumped(
            resolve_node_requirements(
                [node("summarize", "LLMTask", {"prompt": "Summarize this report"})]
            )
        )

        assert result["summarize"] == {
            "capabilities": ["text.generation", "text.summarization"],
            "model_alias": "FAST",
        }

    def test_config_hints_are_validated_and_merged_without_duplicates(self) -> None:
        result = dumped(
            resolve_node_requirements(
                [
                    node(
                        "custom",
                        "LLMTask",
                        {
                            "description": "Implement code",
                            "capabilities": ["domain.finance", "code.generation"],
                            "model_alias": "CEILING",
                            "preferred_agent_id": VALID_AGENT_ID,
                            "maximum_input_bytes": 4096,
                            "tools": [{"name": "ledger.read", "permissions": ["ledger:read"]}],
                        },
                    )
                ]
            )
        )

        assert result["custom"] == {
            "capabilities": [
                "text.generation",
                "code.generation",
                "domain.finance",
            ],
            "model_alias": "CEILING",
            "tools": [{"name": "ledger.read", "permissions": ["ledger:read"]}],
            "preferred_agent_id": VALID_AGENT_ID,
            "maximum_input_bytes": 4096,
        }

    def test_metadata_ui_is_never_used_for_runtime_requirements(self) -> None:
        result = dumped(
            resolve_node_requirements(
                [
                    node(
                        "gate",
                        "Gate",
                        ui={
                            "capabilities": ["must.not.leak"],
                            "model_alias": "CEILING",
                            "tool_name": "must.not.run",
                        },
                    )
                ]
            )
        )

        assert result == {"gate": {"capabilities": []}}

    def test_duplicate_node_keys_fail_instead_of_collapsing_mapping(self) -> None:
        with pytest.raises(CapabilityResolutionError, match="duplicate node key"):
            resolve_node_requirements([node("same", "Gate"), node("same", "Merge")])

    def test_empty_input_fails_instead_of_returning_non_dag_shape(self) -> None:
        with pytest.raises(CapabilityResolutionError, match="at least one node"):
            resolve_node_requirements([])

    @pytest.mark.parametrize(
        "config",
        [
            {},
            {"tools": []},
            {"tool_name": "search.web", "tools": []},
            {"tool_name": "   "},
            {"tool_name": "search.web", "permissions": [""]},
        ],
    )
    def test_invalid_tool_call_config_fails_loudly(self, config: dict[str, Any]) -> None:
        with pytest.raises(CapabilityResolutionError):
            resolve_node_requirements([node("tool", "ToolCall", config)])

    def test_workflow_node_rejects_missing_ui_and_unknown_node_type(self) -> None:
        with pytest.raises(ValidationError):
            WorkflowDagNode.model_validate(
                {"key": "gate", "type": "Gate", "config": {}, "metadata": {}}
            )
        with pytest.raises(ValidationError):
            WorkflowDagNode.model_validate(node("invented", "HttpRequest"))
