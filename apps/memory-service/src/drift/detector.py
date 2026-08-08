from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Literal

from src.memory_learning.ids import raw_uuid7
from src.policy_store.service import PolicyStoreService

from .intelligence_client import IntelligencePerformanceClient
from .models import (
    ComputeAgentDriftRequest,
    ComputeAgentDriftResponse,
    ListAgentDriftRequest,
    ListAgentDriftResponse,
    PerformanceObservation,
)
from .repository import SqlAlchemyDriftRepository


class DriftValidationError(ValueError):
    pass


class InsufficientPerformanceDataError(RuntimeError):
    pass


class DriftDetector:
    def __init__(
        self,
        client: IntelligencePerformanceClient,
        repository: SqlAlchemyDriftRepository,
        policy_store: PolicyStoreService,
        *,
        window_size: int,
        failure_threshold: float,
    ) -> None:
        if window_size < 2:
            raise ValueError("window_size must be at least 2")
        if not 0 <= failure_threshold <= 1:
            raise ValueError("failure_threshold must be between 0 and 1")
        self._client = client
        self._repository = repository
        self._policy_store = policy_store
        self._window_size = window_size
        self._failure_threshold = failure_threshold

    async def compute_agent_drift(
        self,
        request: ComputeAgentDriftRequest,
        authorization: str,
    ) -> ComputeAgentDriftResponse:
        self._validate_authorization(authorization)
        self._raw_id(request.tenant_id, "ten")
        self._raw_id(request.agent_id, "agt")
        performance = await self._client.load_agent_performance(
            tenant_id=request.tenant_id,
            agent_id=request.agent_id,
            task_class=request.task_class,
            limit=self._window_size * 2,
            authorization=authorization,
        )
        if performance.agent_id != request.agent_id or performance.task_class != request.task_class:
            raise DriftValidationError("intelligence performance response identity mismatch")
        if len(performance.observations) < self._window_size * 2:
            raise InsufficientPerformanceDataError(
                f"At least {self._window_size * 2} observations are required"
            )

        recent = performance.observations[: self._window_size]
        baseline_window = performance.observations[
            self._window_size : self._window_size * 2
        ]
        recent_rate = _failure_rate(recent)
        baseline = _failure_rate(baseline_window)
        score = max(0.0, recent_rate - baseline)
        action: Literal["none", "flagged", "weight_decay"] = "none"
        if score > self._failure_threshold:
            action = "weight_decay" if await self._policy_store.apply_drift_decay(
                tenant_id=request.tenant_id, score=score, authorization=authorization
            ) else "flagged"
        stored = await asyncio.to_thread(
            self._repository.record_agent_score,
            agent_id=request.agent_id,
            task_class=request.task_class,
            score=score,
            baseline=baseline,
            recent_rate=recent_rate,
            baseline_count=len(baseline_window),
            recent_count=len(recent),
            threshold=self._failure_threshold,
            action_taken=action,
        )
        return ComputeAgentDriftResponse(
            drift_score_id=stored.drift_score_id,
            subject_type="agent",
            subject_ref=request.agent_id,
            task_class=request.task_class,
            score=stored.score,
            baseline=stored.baseline,
            action_taken=stored.action_taken,
        )

    async def list_agent_drift(
        self,
        request: ListAgentDriftRequest,
        authorization: str,
    ) -> ListAgentDriftResponse:
        self._validate_authorization(authorization)
        self._raw_id(request.tenant_id, "ten")
        self._raw_id(request.agent_id, "agt")
        scores = await asyncio.to_thread(
            self._repository.list_agent_scores,
            tenant_uuid=request.tenant_id,
            agent_id=request.agent_id,
        )
        return ListAgentDriftResponse(agent_id=request.agent_id, scores=scores)

    @staticmethod
    def _raw_id(value: str, prefix: str) -> str:
        try:
            return raw_uuid7(value, prefix)
        except ValueError as error:
            raise DriftValidationError(str(error)) from error

    @staticmethod
    def _validate_authorization(authorization: str) -> None:
        if not authorization.startswith("Bearer ") or not authorization.removeprefix(
            "Bearer "
        ).strip():
            raise DriftValidationError("valid bearer authorization is required")


def _failure_rate(observations: Sequence[PerformanceObservation]) -> float:
    failures = sum(observation.verdict != "success" for observation in observations)
    return failures / len(observations)
