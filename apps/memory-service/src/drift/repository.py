from __future__ import annotations

from sqlalchemy.orm import Session, sessionmaker

from src.db.models import DriftScore
from src.memory_learning.ids import new_prefixed_uuid7

from .models import DriftAction, StoredDriftScore


class SqlAlchemyDriftRepository:
    def __init__(self, system_sessions: sessionmaker[Session]) -> None:
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
