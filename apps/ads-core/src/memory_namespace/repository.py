from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from src.db.ids import new_prefixed_id
from src.db.models import MemoryNamespace, Scope

from .models import MemoryFact, MemoryNamespaceKind

_SET_TENANT = text("SELECT set_config('app.current_tenant_id', :tenant_id, true)")


class ScopeNotFoundError(ValueError):
    pass


class SqlAlchemyMemoryNamespaceRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def record(
        self,
        *,
        tenant_uuid: str,
        scope_id: str,
        project_ref: str | None,
        kind: MemoryNamespaceKind,
        statement: str,
        confidence: float | None,
        provenance: dict[str, object],
    ) -> str:
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            scope_exists = session.scalar(
                select(Scope.id).where(Scope.tenant_id == tenant_uuid, Scope.id == scope_id)
            )
            if scope_exists is None:
                raise ScopeNotFoundError("Scope does not exist for requesting tenant")
            record_id = new_prefixed_id("mns")
            session.add(
                MemoryNamespace(
                    id=record_id,
                    tenant_id=tenant_uuid,
                    scope_id=scope_id,
                    project_ref=project_ref,
                    kind=kind,
                    statement=statement,
                    confidence=confidence,
                    provenance=provenance,
                    status="active",
                )
            )
            session.flush()
            return record_id

    def list_active_for_scopes(
        self, *, tenant_uuid: str, scope_ids: tuple[str, ...], limit: int
    ) -> tuple[MemoryFact, ...]:
        """Scoped by scope_id, not project_ref -- scope_id is the real,
        FK-validated concept record() already requires and the same
        concept RetrievalRequest.scope_ids already uses to gate document
        chunks, so this reuses an existing mechanism rather than inventing
        a project_ref mapping memory-service has no data to support."""
        if not scope_ids:
            return ()
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            rows = session.scalars(
                select(MemoryNamespace)
                .where(
                    MemoryNamespace.tenant_id == tenant_uuid,
                    MemoryNamespace.scope_id.in_(scope_ids),
                    MemoryNamespace.status == "active",
                )
                .order_by(MemoryNamespace.created_at.desc())
                .limit(limit)
            ).all()
            return tuple(
                MemoryFact(
                    id=row.id,
                    kind=row.kind,  # type: ignore[arg-type]
                    statement=row.statement,
                    confidence=float(row.confidence) if row.confidence is not None else None,
                    provenance=row.provenance,
                )
                for row in rows
            )

    @staticmethod
    def _set_tenant(session: Session, tenant_id: str) -> None:
        session.execute(_SET_TENANT, {"tenant_id": tenant_id})
