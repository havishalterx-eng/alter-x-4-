from datetime import UTC, datetime, timedelta

from src.query.models import RetrievalHit
from src.query.quality import rerank_and_reconstruct


def _hit(
    *,
    chunk_id: str,
    seq: int = 0,
    context: str,
    semantic: float,
    keyword: float,
    freshness_at: datetime | None = None,
) -> RetrievalHit:
    return RetrievalHit(
        document_id="doc_00000000-0000-7000-8000-000000000001",
        chunk_id=chunk_id,
        seq=seq,
        source_id="src_00000000-0000-7000-8000-000000000002",
        scope_id="scp_00000000-0000-7000-8000-000000000003",
        context=context,
        reconstructed_context=context,
        score=0.0,
        confidence=0.0,
        provenance={"ingestion": {"job": "ing_test"}},
        metadata={"department": "support"},
        freshness_at=freshness_at,
        semantic_score=semantic,
        keyword_score=keyword,
    )


def test_reranking_prefers_stronger_semantic_and_keyword_evidence() -> None:
    weaker = _hit(chunk_id="chk_b", context="weaker", semantic=0.6, keyword=0.1)
    stronger = _hit(chunk_id="chk_a", context="stronger", semantic=0.9, keyword=0.8)

    ranked = rerank_and_reconstruct((weaker, stronger))

    assert [hit.chunk_id for hit in ranked] == ["chk_a", "chk_b"]
    assert 0.0 <= ranked[0].confidence <= 1.0
    adsq = ranked[0].provenance["adsq"]
    assert isinstance(adsq, dict)
    assert adsq["ranking_version"] == "know9-v1"


def test_context_reconstruction_uses_only_returned_chunk_text_in_stable_order() -> None:
    later = _hit(
        chunk_id="chk_b", seq=1, context="second source chunk", semantic=0.8, keyword=0.0
    )
    earlier = _hit(
        chunk_id="chk_a", seq=0, context="first source chunk", semantic=0.8, keyword=0.0
    )

    ranked = rerank_and_reconstruct((later, earlier))

    assert ranked[0].reconstructed_context == "first source chunk\n\nsecond source chunk"
    assert ranked[1].reconstructed_context == "first source chunk\n\nsecond source chunk"


def test_context_reconstruction_uses_chunk_sequence_not_uuid_order() -> None:
    first = _hit(
        chunk_id="chk_00000000-0000-7000-8000-000000000003",
        seq=0,
        context="first source chunk",
        semantic=0.8,
        keyword=0.0,
    )
    second = _hit(
        chunk_id="chk_00000000-0000-7000-8000-000000000001",
        seq=1,
        context="second source chunk",
        semantic=0.8,
        keyword=0.0,
    )
    third = _hit(
        chunk_id="chk_00000000-0000-7000-8000-000000000002",
        seq=2,
        context="third source chunk",
        semantic=0.8,
        keyword=0.0,
    )

    ranked = rerank_and_reconstruct((second, third, first))

    expected = "first source chunk\n\nsecond source chunk\n\nthird source chunk"
    assert all(hit.reconstructed_context == expected for hit in ranked)


def test_freshness_increases_otherwise_equal_confidence() -> None:
    recent = _hit(
        chunk_id="chk_recent",
        context="recent",
        semantic=0.7,
        keyword=0.2,
        freshness_at=datetime.now(UTC) - timedelta(days=1),
    )
    stale = _hit(
        chunk_id="chk_stale",
        context="stale",
        semantic=0.7,
        keyword=0.2,
        freshness_at=datetime.now(UTC) - timedelta(days=730),
    )

    ranked = rerank_and_reconstruct((stale, recent))

    assert ranked[0].chunk_id == "chk_recent"
    assert ranked[0].confidence > ranked[1].confidence
