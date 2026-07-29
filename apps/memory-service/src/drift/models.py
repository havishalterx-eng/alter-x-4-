from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PerformanceVerdict = Literal["success", "failure", "partial", "escalated"]
DriftAction = Literal["none", "flagged"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PerformanceObservation(StrictModel):
    verdict: PerformanceVerdict
    latency_ms: int | None
    token_count: int | None
    recorded_at: datetime


class AgentPerformance(StrictModel):
    agent_id: str
    task_class: str
    observations: tuple[PerformanceObservation, ...]


class ComputeAgentDriftRequest(StrictModel):
    tenant_id: str
    agent_id: str
    task_class: str = Field(min_length=1, max_length=100)


class ComputeAgentDriftResponse(StrictModel):
    drift_score_id: str
    subject_type: Literal["agent"]
    subject_ref: str
    task_class: str
    score: float
    baseline: float
    action_taken: DriftAction


class StoredDriftScore(StrictModel):
    drift_score_id: str
    score: float
    baseline: float
    action_taken: DriftAction
