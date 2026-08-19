from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PerformanceVerdict = Literal["success", "failure", "partial", "escalated"]
DriftAction = Literal["none", "flagged", "weight_decay"]


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


class ListAgentDriftRequest(StrictModel):
    tenant_id: str
    agent_id: str


class ListAgentDriftResponse(StrictModel):
    agent_id: str
    scores: tuple[StoredDriftScore, ...]


class ModelOutcomeObservation(StrictModel):
    verdict: PerformanceVerdict
    recorded_at: datetime


class ModelOutcomeWindow(StrictModel):
    observations: tuple[ModelOutcomeObservation, ...]


# A "model" is a (provider, resource) pair -- the same two-part key
# cost-ledger-service's own model_pricing/cost_events tables already use
# (e.g. provider="bedrock/claude-sonnet-5", resource="tokens"). A
# "provider" drift request omits resource on purpose: it aggregates across
# every resource for that provider, a coarser platform-health signal than
# any one model's.
class ComputeModelDriftRequest(StrictModel):
    provider: str = Field(min_length=1, max_length=200)
    resource: str = Field(min_length=1, max_length=100)


class ComputeModelDriftResponse(StrictModel):
    drift_score_id: str
    subject_type: Literal["model"]
    subject_ref: str
    score: float
    baseline: float
    action_taken: DriftAction


class ComputeProviderDriftRequest(StrictModel):
    provider: str = Field(min_length=1, max_length=200)


class ComputeProviderDriftResponse(StrictModel):
    drift_score_id: str
    subject_type: Literal["provider"]
    subject_ref: str
    score: float
    baseline: float
    action_taken: DriftAction


class ListModelDriftRequest(StrictModel):
    provider: str = Field(min_length=1, max_length=200)


class ListModelDriftResponse(StrictModel):
    provider: str
    scores: tuple[StoredDriftScore, ...]


class ListProviderDriftRequest(StrictModel):
    provider: str = Field(min_length=1, max_length=200)


class ListProviderDriftResponse(StrictModel):
    provider: str
    scores: tuple[StoredDriftScore, ...]
