from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from src.db.ids import new_prefixed_id, validate_prefixed_id

from .models import RetrievalHit, RetrievalRequest

_SET_TENANT = text("SELECT set_config('app.current_tenant_id', :tenant_id, true)")
_QUERY = text(
    """
WITH candidates AS (
  SELECT c.id AS chunk_id, c.document_id, d.source_id, c.scope_id,
         c.text_content, COALESCE(c.metadata, '{}'::jsonb) AS metadata,
         dv.provenance,
         1 - (c.embedding <=> CAST(:embedding AS vector)) AS semantic_score,
         ts_rank_cd(c.text_search, websearch_to_tsquery('english', :query)) AS keyword_score
  FROM chunks c
  JOIN documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id
  JOIN document_versions dv ON dv.document_id = c.document_id
       AND dv.version = c.document_version
  JOIN scopes s ON s.id = c.scope_id AND s.tenant_id = c.tenant_id
  WHERE c.tenant_id = CAST(:tenant_id AS uuid)
    AND s.workspace_id = CAST(:workspace_id AS uuid)
    AND d.status = 'active'
    AND (
      cardinality(CAST(:scope_ids AS text[])) = 0
      OR c.scope_id = ANY(CAST(:scope_ids AS text[]))
    )
    AND COALESCE(c.metadata, '{}'::jsonb) @> CAST(:metadata_filter AS jsonb)
)
SELECT *, (0.7 * semantic_score + 0.3 * LEAST(keyword_score, 1)) AS hybrid_score
FROM candidates
ORDER BY hybrid_score DESC, document_id ASC, chunk_id ASC
LIMIT :limit
"""
)
_AUDIT = text(
    """
INSERT INTO retrieval_audit
  (id, tenant_id, scope_id, requester, query_hash, result_doc_ids, confidence)
VALUES (:id, CAST(:tenant_id AS uuid), :scope_id, :requester, :query_hash,
        CAST(:result_doc_ids AS jsonb), :confidence)
RETURNING created_at
"""
)
_AUDIT_SCOPE = text(
    """SELECT id FROM scopes WHERE tenant_id = CAST(:tenant_id AS uuid)
       AND workspace_id = CAST(:workspace_id AS uuid) ORDER BY id LIMIT 1"""
)
_PROVENANCE = text(
    """SELECT dv.provenance FROM documents d
       JOIN document_versions dv ON dv.document_id = d.id AND dv.version = d.current_version
       WHERE d.tenant_id = CAST(:tenant_id AS uuid) AND d.id = :document_id"""
)


@dataclass(frozen=True)
class QueryResult:
    hits: tuple[RetrievalHit, ...]
    audited_at: datetime | None


class SqlAlchemyRetrievalRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def retrieve(self, request: RetrievalRequest, embedding: tuple[float, ...]) -> QueryResult:
        validate_prefixed_id("ten", request.tenant_id)
        validate_prefixed_id("ws", request.workspace_id)
        for scope_id in request.scope_ids:
            validate_prefixed_id(scope_id.split("_", 1)[0], scope_id)
        if len(embedding) != 1024:
            raise ValueError("ADS Q requires a 1024-dimension query embedding")

        tenant_uuid = request.tenant_id.removeprefix("ten_")
        workspace_uuid = request.workspace_id.removeprefix("ws_")
        with self._sessions.begin() as session:
            session.execute(_SET_TENANT, {"tenant_id": tenant_uuid})
            rows = session.execute(
                _QUERY,
                {
                    "tenant_id": tenant_uuid,
                    "workspace_id": workspace_uuid,
                    "embedding": _vector_literal(embedding),
                    "query": request.query,
                    "scope_ids": list(request.scope_ids),
                    "metadata_filter": json.dumps(request.metadata_filter, separators=(",", ":")),
                    "limit": request.top_k,
                },
            ).mappings()
            hits = tuple(self._hit(row) for row in rows)
            audit_scope = (
                request.scope_ids[0]
                if request.scope_ids
                else session.scalar(
                    _AUDIT_SCOPE, {"tenant_id": tenant_uuid, "workspace_id": workspace_uuid}
                )
            )
            if audit_scope is None:
                return QueryResult(hits=hits, audited_at=None)
            audited_at = session.scalar(
                _AUDIT,
                {
                    "id": new_prefixed_id("rta"),
                    "tenant_id": tenant_uuid,
                    "scope_id": audit_scope,
                    "requester": request.requester,
                    "query_hash": hashlib.sha256(request.query.encode("utf-8")).hexdigest(),
                    "result_doc_ids": json.dumps(
                        {"document_ids": [hit.document_id for hit in hits]}
                    ),
                    "confidence": max((hit.confidence for hit in hits), default=0.0),
                },
            )
            return QueryResult(hits=hits, audited_at=cast(datetime, audited_at))

    def provenance(self, *, tenant_id: str, document_id: str) -> dict[str, object] | None:
        validate_prefixed_id("ten", tenant_id)
        validate_prefixed_id("doc", document_id)
        with self._sessions.begin() as session:
            tenant_uuid = tenant_id.removeprefix("ten_")
            session.execute(_SET_TENANT, {"tenant_id": tenant_uuid})
            row = session.scalar(
                _PROVENANCE, {"tenant_id": tenant_uuid, "document_id": document_id}
            )
            return None if row is None else dict(cast(dict[str, object], row))

    @staticmethod
    def _hit(row: object) -> RetrievalHit:
        mapped = cast(dict[str, object], row)
        score = float(cast(float, mapped["hybrid_score"]))
        return RetrievalHit(
            document_id=str(mapped["document_id"]),
            chunk_id=str(mapped["chunk_id"]),
            source_id=str(mapped["source_id"]),
            scope_id=str(mapped["scope_id"]),
            context=str(mapped["text_content"]),
            score=score,
            confidence=max(0.0, min(1.0, score)),
            provenance=dict(cast(dict[str, object], mapped["provenance"])),
            metadata=dict(cast(dict[str, object], mapped["metadata"])),
        )


def _vector_literal(values: tuple[float, ...]) -> str:
    return "[" + ",".join(str(value) for value in values) + "]"
