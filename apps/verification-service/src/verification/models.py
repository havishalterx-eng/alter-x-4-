"""Pydantic mirrors of packages/contracts/proto/alter/verification/v1/verification.proto.

Field names and shapes must stay identical to the proto. Do not add fields
that are not in the proto and do not diverge field types/nullability from
it. packages/contracts is the single source of truth for this contract;
this module only provides typed Python homes for the requests/responses.
"""

import re
from typing import Literal

from pydantic import BaseModel, field_validator

_UUID_V7_BODY = r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"

_TENANT_ID_RE = re.compile(rf"^ten_{_UUID_V7_BODY}$", re.IGNORECASE)
_RUN_ID_RE = re.compile(rf"^run_{_UUID_V7_BODY}$", re.IGNORECASE)
_NODE_EXECUTION_ID_RE = re.compile(rf"^node_{_UUID_V7_BODY}$", re.IGNORECASE)

# Matches packages/contracts/src/workflow-dag.ts's NodeTypeSchema exactly.
NodeType = Literal[
    "LLMTask",
    "ToolCall",
    "SandboxExec",
    "Gate",
    "HumanApproval",
    "Merge",
    "Synthesis",
    "MemoryWrite",
    "PubSub",
    "GroupChat",
    "YAMLImport",
]

Verdict = Literal["pass", "fail", "warn"]


def _validate_pattern(pattern: re.Pattern[str], value: str, field: str) -> str:
    if not pattern.match(value):
        raise ValueError(f"{field} must match {pattern.pattern}")
    return value


class ScoreNodeRequest(BaseModel):
    model_config = {"frozen": True}

    tenant_id: str
    run_id: str
    node_execution_id: str
    node_key: str
    node_type: NodeType
    config_json: str
    output_json: str

    @field_validator("tenant_id")
    @classmethod
    def _validate_tenant_id(cls, v: str) -> str:
        return _validate_pattern(_TENANT_ID_RE, v, "tenant_id")

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, v: str) -> str:
        return _validate_pattern(_RUN_ID_RE, v, "run_id")

    @field_validator("node_execution_id")
    @classmethod
    def _validate_node_execution_id(cls, v: str) -> str:
        return _validate_pattern(_NODE_EXECUTION_ID_RE, v, "node_execution_id")

    @field_validator("node_key")
    @classmethod
    def _validate_node_key(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("node_key must not be blank")
        return v


class ScoreNodeResponse(BaseModel):
    model_config = {"frozen": True}

    verdict: Verdict
    score: float
    threshold: float
    reviewer_model: str
    details_json: str
