from __future__ import annotations

import statistics
from collections.abc import Sequence
from dataclasses import dataclass

from .models import RetrievalHit, RetrievalRequest
from .service import RetrievalService

RECALL_K = 10


@dataclass(frozen=True)
class GoldenSetCase:
    """One real query -> real expected-relevant-document(s) pair.

    `relevant_document_ids` is deliberately a set, not a single id -- a
    real golden set can have more than one correct answer per query.
    Must be non-empty; a case with no relevant document is not a
    meaningful recall measurement and is rejected at evaluation time
    rather than silently scored.
    """

    query: str
    relevant_document_ids: frozenset[str]
    scope_ids: tuple[str, ...]
    metadata_filter: dict[str, object] | None = None


@dataclass(frozen=True)
class GoldenSetCaseResult:
    case: GoldenSetCase
    recall_at_k: float
    retrieved_document_ids: tuple[str, ...]


def recall_at_k(
    hits: Sequence[RetrievalHit],
    relevant_document_ids: frozenset[str],
    k: int = RECALL_K,
) -> float:
    """Real recall@k: |top-k retrieved ∩ relevant| / |relevant|.

    Raises on an empty `relevant_document_ids` rather than returning a
    silently-meaningless 1.0 or 0.0 -- a golden-set case with zero known-
    correct answers cannot produce a real recall measurement.
    """
    if not relevant_document_ids:
        raise ValueError("relevant_document_ids must be non-empty to compute recall")
    retrieved_ids = {hit.document_id for hit in hits[:k]}
    found = retrieved_ids & relevant_document_ids
    return len(found) / len(relevant_document_ids)


def evaluate_golden_set(
    service: RetrievalService,
    *,
    tenant_id: str,
    workspace_id: str,
    requester: str,
    cases: Sequence[GoldenSetCase],
    k: int = RECALL_K,
) -> tuple[float, tuple[GoldenSetCaseResult, ...]]:
    """Runs every real case through the real retrieval service and
    returns (mean recall@k across the set, per-case results) -- this is
    the real, measurable number Phase 7's exit check asked for, not a
    qualitative "reranking prefers X" assertion."""
    results: list[GoldenSetCaseResult] = []
    for case in cases:
        response = service.retrieve(
            RetrievalRequest(
                tenant_id=tenant_id,
                workspace_id=workspace_id,
                requester=requester,
                query=case.query,
                top_k=k,
                scope_ids=case.scope_ids,
                metadata_filter=case.metadata_filter or {},
            )
        )
        score = recall_at_k(response.hits, case.relevant_document_ids, k=k)
        results.append(
            GoldenSetCaseResult(
                case=case,
                recall_at_k=score,
                retrieved_document_ids=tuple(hit.document_id for hit in response.hits[:k]),
            )
        )
    mean_recall = statistics.fmean(result.recall_at_k for result in results)
    return mean_recall, tuple(results)
