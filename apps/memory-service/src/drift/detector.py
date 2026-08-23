from __future__ import annotations

import asyncio
import math
from collections.abc import Sequence
from typing import Literal, Protocol

from src.memory_learning.ids import raw_uuid7
from src.policy_store.service import PolicyStoreService

from .cost_ledger_client import CostLedgerOutcomeClient
from .intelligence_client import IntelligencePerformanceClient
from .models import (
    ComputeAgentDriftRequest,
    ComputeAgentDriftResponse,
    ComputeModelDriftRequest,
    ComputeModelDriftResponse,
    ComputeProviderDriftRequest,
    ComputeProviderDriftResponse,
    DriftAction,
    ListAgentDriftRequest,
    ListAgentDriftResponse,
    ListModelDriftRequest,
    ListModelDriftResponse,
    ListProviderDriftRequest,
    ListProviderDriftResponse,
    ModelOutcomeWindow,
    PerformanceVerdict,
)
from .repository import SqlAlchemyDriftRepository


class _HasVerdict(Protocol):
    verdict: PerformanceVerdict


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
        outcome_client: CostLedgerOutcomeClient,
        significance_level: float = 0.05,
    ) -> None:
        if window_size < 2:
            raise ValueError("window_size must be at least 2")
        if not 0 <= failure_threshold <= 1:
            raise ValueError("failure_threshold must be between 0 and 1")
        if not 0 < significance_level <= 1:
            raise ValueError("significance_level must be between 0 (exclusive) and 1")
        self._client = client
        self._repository = repository
        self._policy_store = policy_store
        self._window_size = window_size
        self._failure_threshold = failure_threshold
        self._outcome_client = outcome_client
        self._significance_level = significance_level

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
        p_value = _fisher_exact_two_tailed_p_value(
            recent_failures=_failure_count(recent),
            recent_total=len(recent),
            baseline_failures=_failure_count(baseline_window),
            baseline_total=len(baseline_window),
        )
        action: Literal["none", "flagged", "weight_decay"] = "none"
        if self._is_significant_drift(score, p_value):
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
            p_value=p_value,
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

    async def compute_model_drift(
        self,
        request: ComputeModelDriftRequest,
        authorization: str,
    ) -> ComputeModelDriftResponse:
        self._validate_authorization(authorization)
        window = await self._outcome_client.load_outcome_window(
            provider=request.provider,
            resource=request.resource,
            limit=self._window_size * 2,
            authorization=authorization,
        )
        score, baseline, recent, baseline_window, p_value = self._score_outcome_window(window)
        action = self._flag_only_action(score, p_value)
        stored = await asyncio.to_thread(
            self._repository.record_model_score,
            provider=request.provider,
            resource=request.resource,
            score=score,
            baseline=baseline,
            recent_rate=_failure_rate(recent),
            baseline_count=len(baseline_window),
            recent_count=len(recent),
            threshold=self._failure_threshold,
            p_value=p_value,
            action_taken=action,
        )
        return ComputeModelDriftResponse(
            drift_score_id=stored.drift_score_id,
            subject_type="model",
            subject_ref=request.provider,
            score=stored.score,
            baseline=stored.baseline,
            action_taken=stored.action_taken,
        )

    async def compute_provider_drift(
        self,
        request: ComputeProviderDriftRequest,
        authorization: str,
    ) -> ComputeProviderDriftResponse:
        self._validate_authorization(authorization)
        window = await self._outcome_client.load_outcome_window(
            provider=request.provider,
            resource=None,
            limit=self._window_size * 2,
            authorization=authorization,
        )
        score, baseline, recent, baseline_window, p_value = self._score_outcome_window(window)
        action = self._flag_only_action(score, p_value)
        stored = await asyncio.to_thread(
            self._repository.record_provider_score,
            provider=request.provider,
            score=score,
            baseline=baseline,
            recent_rate=_failure_rate(recent),
            baseline_count=len(baseline_window),
            recent_count=len(recent),
            threshold=self._failure_threshold,
            p_value=p_value,
            action_taken=action,
        )
        return ComputeProviderDriftResponse(
            drift_score_id=stored.drift_score_id,
            subject_type="provider",
            subject_ref=request.provider,
            score=stored.score,
            baseline=stored.baseline,
            action_taken=stored.action_taken,
        )

    async def list_model_drift(
        self,
        request: ListModelDriftRequest,
        authorization: str,
    ) -> ListModelDriftResponse:
        self._validate_authorization(authorization)
        scores = await asyncio.to_thread(
            self._repository.list_model_scores, provider=request.provider
        )
        return ListModelDriftResponse(provider=request.provider, scores=scores)

    async def list_provider_drift(
        self,
        request: ListProviderDriftRequest,
        authorization: str,
    ) -> ListProviderDriftResponse:
        self._validate_authorization(authorization)
        scores = await asyncio.to_thread(
            self._repository.list_provider_scores, provider=request.provider
        )
        return ListProviderDriftResponse(provider=request.provider, scores=scores)

    def _score_outcome_window(
        self, window: ModelOutcomeWindow
    ) -> tuple[float, float, Sequence[_HasVerdict], Sequence[_HasVerdict], float]:
        observations = window.observations
        if len(observations) < self._window_size * 2:
            raise InsufficientPerformanceDataError(
                f"At least {self._window_size * 2} observations are required"
            )
        recent = observations[: self._window_size]
        baseline_window = observations[self._window_size : self._window_size * 2]
        recent_rate = _failure_rate(recent)
        baseline = _failure_rate(baseline_window)
        score = max(0.0, recent_rate - baseline)
        p_value = _fisher_exact_two_tailed_p_value(
            recent_failures=_failure_count(recent),
            recent_total=len(recent),
            baseline_failures=_failure_count(baseline_window),
            baseline_total=len(baseline_window),
        )
        return score, baseline, recent, baseline_window, p_value

    def _flag_only_action(self, score: float, p_value: float) -> DriftAction:
        # Model/provider drift has no per-tenant routing-weight policy to
        # decay against -- the subject is platform-wide, owned by no single
        # tenant, unlike agent drift's real per-tenant weight_decay path.
        return "flagged" if self._is_significant_drift(score, p_value) else "none"

    def _is_significant_drift(self, score: float, p_value: float) -> bool:
        return _is_significant_drift(
            score, p_value, self._failure_threshold, self._significance_level
        )

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


def _failure_rate(observations: Sequence[_HasVerdict]) -> float:
    failures = sum(observation.verdict != "success" for observation in observations)
    return failures / len(observations)


def _failure_count(observations: Sequence[_HasVerdict]) -> int:
    return sum(observation.verdict != "success" for observation in observations)


def _is_significant_drift(
    score: float, p_value: float, failure_threshold: float, significance_level: float
) -> bool:
    # ENGINE-FIX-P3-28 (Wave 4 item 4): score alone is a raw difference in
    # failure proportions -- with a small window (window_size can be as low
    # as 2), a difference that size is easily noise, not a real regression.
    # Only act when the difference also clears a real statistical
    # significance test.
    return score > failure_threshold and p_value < significance_level


def _fisher_exact_two_tailed_p_value(
    *,
    recent_failures: int,
    recent_total: int,
    baseline_failures: int,
    baseline_total: int,
) -> float:
    """Exact two-tailed Fisher's exact test p-value for the 2x2 table of
    (recent, baseline) x (failure, success) counts.

    Chosen over a normal-approximation two-proportion z-test because
    window_size can be as low as 2 (config floor) -- a z-test's normal
    approximation needs both n*p and n*(1-p) to be at least ~5 to be valid,
    which a window that small can never satisfy. Fisher's exact test is
    exact at any sample size and needs nothing beyond stdlib math.comb, no
    scipy/numpy dependency.

    Holds the row totals (recent_total, baseline_total) and the total
    failure count fixed, enumerates every possible split of that failure
    count between the two rows, and sums the hypergeometric probability of
    every split at least as extreme as the one observed.
    """
    total_failures = recent_failures + baseline_failures
    total = recent_total + baseline_total
    low = max(0, total_failures - baseline_total)
    high = min(recent_total, total_failures)

    def table_probability(recent_failure_count: int) -> float:
        return (
            math.comb(recent_total, recent_failure_count)
            * math.comb(baseline_total, total_failures - recent_failure_count)
            / math.comb(total, total_failures)
        )

    observed_probability = table_probability(recent_failures)
    # +1e-9 tolerance: floating point must never exclude the observed table
    # itself from its own two-tailed sum.
    return sum(
        probability
        for split in range(low, high + 1)
        if (probability := table_probability(split)) <= observed_probability * (1 + 1e-9)
    )
