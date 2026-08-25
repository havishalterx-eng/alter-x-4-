from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime

from .models import RetrievalHit


def rerank_and_reconstruct(hits: tuple[RetrievalHit, ...]) -> tuple[RetrievalHit, ...]:
    """Stable scoring and faithful context shaping; no model-generated text."""

    grouped: dict[str, list[RetrievalHit]] = defaultdict(list)
    for hit in hits:
        grouped[hit.document_id].append(hit)

    ranked: list[RetrievalHit] = []
    for hit in hits:
        score = _score(hit)
        context = _context(grouped[hit.document_id])
        ranked.append(
            hit.model_copy(
                update={
                    "score": score,
                    "confidence": _confidence(hit, score),
                    "reconstructed_context": context,
                    "provenance": {
                        **hit.provenance,
                        "adsq": {
                            "chunk_id": hit.chunk_id,
                            "semantic_score": round(hit.semantic_score, 6),
                            "keyword_score": round(hit.keyword_score, 6),
                            "ranking_version": "know9-v1",
                        },
                    },
                }
            )
        )
    return tuple(sorted(ranked, key=lambda hit: (-hit.score, hit.document_id, hit.chunk_id)))


def _score(hit: RetrievalHit) -> float:
    freshness = _freshness(hit.freshness_at)
    metadata = 1.0 if hit.metadata else 0.0
    return _bounded(
        0.55 * hit.semantic_score
        + 0.30 * min(hit.keyword_score, 1.0)
        + 0.10 * freshness
        + 0.05 * metadata
    )


def _confidence(hit: RetrievalHit, score: float) -> float:
    evidence = 0.10 if hit.provenance else 0.0
    return _bounded(0.85 * score + evidence + 0.05 * _freshness(hit.freshness_at))


def _freshness(value: datetime | None) -> float:
    if value is None:
        return 0.5
    age_days = max(0.0, (datetime.now(UTC) - value).total_seconds() / 86_400)
    return max(0.0, 1.0 - age_days / 365)


def _context(hits: list[RetrievalHit]) -> str:
    return "\n\n".join(hit.context for hit in sorted(hits, key=lambda hit: hit.seq))


def _bounded(value: float) -> float:
    return max(0.0, min(1.0, value))
