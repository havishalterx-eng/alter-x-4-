from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

PerformanceVerdict = Literal["success", "failure", "partial", "escalated"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PerformanceObservation(StrictModel):
    verdict: PerformanceVerdict
    latency_ms: int | None
    token_count: int | None
    recorded_at: datetime


class AgentPerformanceResponse(StrictModel):
    agent_id: str
    task_class: str
    observations: tuple[PerformanceObservation, ...]


class DriftCandidate(StrictModel):
    tenant_id: str
    agent_id: str
    task_class: str


class DriftCandidateResponse(StrictModel):
    candidates: tuple[DriftCandidate, ...]
