from __future__ import annotations

from typing import cast

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import PerformanceRecord

from .models import DriftCandidate, PerformanceObservation, PerformanceVerdict

_SET_TENANT = text("SELECT set_config('app.current_tenant_id', :tenant_id, true)")


class PerformanceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def load_agent_observations(
        self,
        *,
        tenant_uuid: str,
        agent_id: str,
        task_class: str,
        limit: int,
    ) -> tuple[PerformanceObservation, ...]:
        await self._session.execute(_SET_TENANT, {"tenant_id": tenant_uuid})
        rows = (
            await self._session.scalars(
                select(PerformanceRecord)
                .where(
                    PerformanceRecord.tenant_id == tenant_uuid,
                    PerformanceRecord.agent_id == agent_id,
                    PerformanceRecord.task_category == task_class,
                )
                .order_by(
                    PerformanceRecord.recorded_at.desc(),
                    PerformanceRecord.created_at.desc(),
                    PerformanceRecord.id.desc(),
                )
                .limit(limit)
            )
        ).all()
        return tuple(
            PerformanceObservation(
                verdict=cast(PerformanceVerdict, row.verdict),
                latency_ms=row.latency_ms,
                token_count=row.token_count,
                recorded_at=row.recorded_at,
            )
            for row in rows
        )

    async def list_drift_candidates(
        self, *, minimum_observations: int
    ) -> tuple[DriftCandidate, ...]:
        rows = (
            await self._session.execute(
                select(
                    PerformanceRecord.tenant_id,
                    PerformanceRecord.agent_id,
                    PerformanceRecord.task_category,
                )
                .where(PerformanceRecord.task_category.is_not(None))
                .group_by(
                    PerformanceRecord.tenant_id,
                    PerformanceRecord.agent_id,
                    PerformanceRecord.task_category,
                )
                .having(func.count() >= minimum_observations)
                .order_by(
                    PerformanceRecord.tenant_id,
                    PerformanceRecord.agent_id,
                    PerformanceRecord.task_category,
                )
            )
        ).all()
        return tuple(
            DriftCandidate(
                tenant_id=f"ten_{tenant_id}",
                agent_id=agent_id,
                task_class=task_class,
            )
            for tenant_id, agent_id, task_class in rows
            if task_class is not None
        )
