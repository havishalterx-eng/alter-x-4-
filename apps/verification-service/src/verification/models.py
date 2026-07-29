"""Typed verification request, reviewer, hallucination, and safety models."""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_UUID_V7_BODY = r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"

_TENANT_ID_RE = re.compile(rf"^ten_{_UUID_V7_BODY}$", re.IGNORECASE)
_RUN_ID_RE = re.compile(rf"^run_{_UUID_V7_BODY}$", re.IGNORECASE)
_NODE_EXECUTION_ID_RE = re.compile(rf"^node_{_UUID_V7_BODY}$", re.IGNORECASE)

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
SafetySeverity = Literal["low", "medium", "high", "critical"]
RecoverySignal = Literal["heal", "terminate"]


def _validate_pattern(pattern: re.Pattern[str], value: str, field: str) -> str:
    if not pattern.match(value):
        raise ValueError(f"{field} must match {pattern.pattern}")
    return value


class ScoreNodeRequest(BaseModel):
    """Mirror of alter.verification.v1.ScoreNodeRequest."""

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
    def _validate_tenant_id(cls, value: str) -> str:
        return _validate_pattern(_TENANT_ID_RE, value, "tenant_id")

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, value: str) -> str:
        return _validate_pattern(_RUN_ID_RE, value, "run_id")

    @field_validator("node_execution_id")
    @classmethod
    def _validate_node_execution_id(cls, value: str) -> str:
        return _validate_pattern(_NODE_EXECUTION_ID_RE, value, "node_execution_id")

    @field_validator("node_key")
    @classmethod
    def _validate_node_key(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("node_key must not be blank")
        return value


class ScoreNodeResponse(BaseModel):
    """Mirror of alter.verification.v1.ScoreNodeResponse."""

    model_config = {"frozen": True}

    verdict: Verdict
    score: float
    threshold: float
    reviewer_model: str
    details_json: str


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FlaggedSpan(_StrictModel):
    text: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class HallucinationAssessment(_StrictModel):
    hallucination_score: float = Field(ge=0, le=1)
    verdict: Literal["pass", "fail"]
    flagged_spans: tuple[FlaggedSpan, ...]
    reasons: tuple[str, ...]


class SafetyAssessment(_StrictModel):
    severity: SafetySeverity
    rationale: str = Field(min_length=1)

    @property
    def recovery_signal(self) -> RecoverySignal:
        return "terminate" if self.severity == "critical" else "heal"


class ProblemDetails(_StrictModel):
    type: str
    title: str = Field(min_length=1)
    status: int = Field(ge=100, le=599)
    detail: str = Field(min_length=1)
    instance: str = Field(pattern=r"^/")
    error_code: str = Field(pattern=r"^[A-Z][A-Z0-9_]*$")
    trace_id: str
    request_id: str
    retryable: bool
    field_errors: tuple[dict[str, str], ...] = ()
    documentation_key: str = Field(pattern=r"^[a-z0-9]+(?:[.-][a-z0-9]+)*$")


class VerificationContext(_StrictModel):
    task_context: dict[str, object]
    response: object
    evidence: dict[str, object]
