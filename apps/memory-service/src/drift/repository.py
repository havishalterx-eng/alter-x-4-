from __future__ import annotations

from typing import cast

from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from src.db.models import DriftScore
from src.memory_learning.ids import new_prefixed_uuid7

from .models import DriftAction, StoredDriftScore

_SET_TENANT = text("SELECT set_config('app.current_tenant_id', :tenant_id, true)")


class SqlAlchemyDriftRepository:
    def __init__(
        self,
        tenant_sessions: sessionmaker[Session],
        system_sessions: sessionmaker[Session],
    ) -> None:
        self._tenant_sessions = tenant_sessions
        self._system_sessions = system_sessions

    def record_agent_score(
        self,
        *,
        agent_id: str,
        task_class: str,
        score: float,
        baseline: float,
        recent_rate: float,
        baseline_count: int,
        recent_count: int,
        threshold: float,
        action_taken: DriftAction,
    ) -> StoredDriftScore:
        with self._system_sessions.begin() as session:
            row = DriftScore(
                id=new_prefixed_uuid7("drift"),
                subject_type="agent",
                subject_ref=agent_id,
                task_class=task_class,
                score=score,
                baseline=baseline,
                window={
                    "formula": "max(0,recent_failure_rate-baseline_failure_rate)",
                    "baseline_failure_rate": baseline,
                    "recent_failure_rate": recent_rate,
                    "baseline_count": baseline_count,
                    "recent_count": recent_count,
                    "flag_threshold": threshold,
                },
                action_taken=action_taken,
            )
            session.add(row)
            session.flush()
            return StoredDriftScore(
                drift_score_id=row.id,
                score=score,
                baseline=baseline,
                action_taken=action_taken,
            )

    def record_model_score(
        self,
        *,
        provider: str,
        resource: str,
        score: float,
        baseline: float,
        recent_rate: float,
        baseline_count: int,
        recent_count: int,
        threshold: float,
        action_taken: DriftAction,
    ) -> StoredDriftScore:
        return self._record_outcome_score(
            subject_type="model",
            subject_ref=provider,
            window_extra={"resource": resource},
            score=score,
            baseline=baseline,
            recent_rate=recent_rate,
            baseline_count=baseline_count,
            recent_count=recent_count,
            threshold=threshold,
            action_taken=action_taken,
        )

    def record_provider_score(
        self,
        *,
        provider: str,
        score: float,
        baseline: float,
        recent_rate: float,
        baseline_count: int,
        recent_count: int,
        threshold: float,
        action_taken: DriftAction,
    ) -> StoredDriftScore:
        return self._record_outcome_score(
            subject_type="provider",
            subject_ref=provider,
            window_extra={},
            score=score,
            baseline=baseline,
            recent_rate=recent_rate,
            baseline_count=baseline_count,
            recent_count=recent_count,
            threshold=threshold,
            action_taken=action_taken,
        )

    def _record_outcome_score(
        self,
        *,
        subject_type: str,
        subject_ref: str,
        window_extra: dict[str, object],
        score: float,
        baseline: float,
        recent_rate: float,
        baseline_count: int,
        recent_count: int,
        threshold: float,
        action_taken: DriftAction,
    ) -> StoredDriftScore:
        # Model/provider outcomes have no tenant_id at all (real model
        # health is platform-wide, not tenant-owned) -- writes go through
        # system_sessions same as record_agent_score, not because of an RLS
        # restriction on this subject_type specifically, but because there
        # is no tenant to scope the write to in the first place.
        with self._system_sessions.begin() as session:
            row = DriftScore(
                id=new_prefixed_uuid7("drift"),
                subject_type=subject_type,
                subject_ref=subject_ref,
                task_class=None,
                score=score,
                baseline=baseline,
                window={
                    "formula": "max(0,recent_failure_rate-baseline_failure_rate)",
                    "baseline_failure_rate": baseline,
                    "recent_failure_rate": recent_rate,
                    "baseline_count": baseline_count,
                    "recent_count": recent_count,
                    "flag_threshold": threshold,
                    **window_extra,
                },
                action_taken=action_taken,
            )
            session.add(row)
            session.flush()
            return StoredDriftScore(
                drift_score_id=row.id,
                score=score,
                baseline=baseline,
                action_taken=action_taken,
            )

    def list_model_scores(self, *, provider: str) -> tuple[StoredDriftScore, ...]:
        return self._list_outcome_scores(subject_type="model", subject_ref=provider)

    def list_provider_scores(self, *, provider: str) -> tuple[StoredDriftScore, ...]:
        return self._list_outcome_scores(subject_type="provider", subject_ref=provider)

    def _list_outcome_scores(
        self, *, subject_type: str, subject_ref: str
    ) -> tuple[StoredDriftScore, ...]:
        """Real read under RLS. Unlike agent-subject rows, drift_read's
        policy (0001_create_policy_tables.py) permits SELECT of
        subject_type IN ('model','provider') for every session unconditionally
        -- it never references app.current_tenant_id at all, since
        model/provider health is a cross-tenant, platform-wide signal owned
        by no single tenant. No SET is needed (unlike list_agent_scores'
        genuinely tenant-scoped read) -- there is no tenant to scope this
        request to."""
        with self._tenant_sessions.begin() as session:
            rows = session.scalars(
                select(DriftScore)
                .where(
                    DriftScore.subject_type == subject_type,
                    DriftScore.subject_ref == subject_ref,
                )
                .order_by(DriftScore.created_at.desc())
            ).all()
            return tuple(
                StoredDriftScore(
                    drift_score_id=row.id,
                    score=float(row.score),
                    baseline=float(row.baseline) if row.baseline is not None else 0.0,
                    action_taken=cast(DriftAction, row.action_taken),
                )
                for row in rows
            )

    def list_agent_scores(
        self, *, tenant_uuid: str, agent_id: str
    ) -> tuple[StoredDriftScore, ...]:
        """Real read under RLS. drift_scores' own drift_read policy
        (0001_create_policy_tables.py) only permits SELECT of
        subject_type IN ('model','provider') rows -- agent-subject rows
        are deliberately default-deny for every tenant session pending
        KNOW-15's local ownership projection, per that migration's own
        docstring. A cross-tenant (or same-tenant) read of another
        agent's drift scores therefore always returns empty here, not
        because of an app-level ownership check but because the real,
        unmodified RLS policy excludes the row entirely."""
        with self._tenant_sessions.begin() as session:
            session.execute(_SET_TENANT, {"tenant_id": tenant_uuid})
            rows = session.scalars(
                select(DriftScore)
                .where(DriftScore.subject_type == "agent", DriftScore.subject_ref == agent_id)
                .order_by(DriftScore.created_at.desc())
            ).all()
            return tuple(
                StoredDriftScore(
                    drift_score_id=row.id,
                    score=float(row.score),
                    baseline=float(row.baseline) if row.baseline is not None else 0.0,
                    action_taken=cast(DriftAction, row.action_taken),
                )
                for row in rows
            )
