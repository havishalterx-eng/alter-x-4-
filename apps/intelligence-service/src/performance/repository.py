from __future__ import annotations

from typing import cast

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import PerformanceRecord

from .models import PerformanceObservation, PerformanceVerdict

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
