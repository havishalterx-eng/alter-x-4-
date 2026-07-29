from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from src.db.models import MemoryRecord

_SET_TENANT = text("SELECT set_config('app.current_tenant_id', :tenant_id, true)")
_LOCK_RUN = text(
    "SELECT pg_advisory_xact_lock(hashtextextended(:idempotency_key, 0))"
)
_FIND_EXISTING = text(
    """
    SELECT id, content
      FROM memory_records
     WHERE tenant_id = :tenant_id
       AND status = 'candidate'
       AND provenance->>'run_id' = :run_id
     ORDER BY created_at ASC
     LIMIT 1
    """
)


@dataclass(frozen=True)
class StoredCandidate:
    memory_id: str
    content: dict[str, object]


class MemoryCandidateRepository(Protocol):
    def propose(
        self,
        *,
        memory_id: str,
        tenant_uuid: str,
        run_id: str,
        scope: str,
        content: dict[str, object],
        provenance: dict[str, object],
    ) -> StoredCandidate: ...


class SqlAlchemyMemoryCandidateRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def propose(
        self,
        *,
        memory_id: str,
        tenant_uuid: str,
        run_id: str,
        scope: str,
        content: dict[str, object],
        provenance: dict[str, object],
    ) -> StoredCandidate:
        with self._sessions.begin() as session:
            session.execute(_SET_TENANT, {"tenant_id": tenant_uuid})
            session.execute(
                _LOCK_RUN,
                {"idempotency_key": f"memory-writeback:{tenant_uuid}:{run_id}"},
            )
            existing = session.execute(
                _FIND_EXISTING,
                {"tenant_id": tenant_uuid, "run_id": run_id},
            ).mappings().one_or_none()
            if existing is not None:
                return StoredCandidate(
                    memory_id=str(existing["id"]),
                    content=dict(existing["content"]),
                )

            session.add(
                MemoryRecord(
                    id=memory_id,
                    tenant_id=tenant_uuid,
                    scope=scope,
                    content=content,
                    provenance=provenance,
                    status="candidate",
                    destination=None,
                )
            )
            session.flush()
            return StoredCandidate(memory_id=memory_id, content=content)
