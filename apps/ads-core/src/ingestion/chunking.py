from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

_TEXT_LIKE_CONTENT_TYPES = frozenset({"text/plain", "application/json"})
_MAX_CHUNK_CHARS = 1000
_MIN_CHUNK_CHARS = 200


@dataclass(frozen=True)
class Chunk:
    seq: int
    text: str


class UnsupportedContentTypeError(ValueError):
    """No real text-extraction exists for this content type yet.

    Raised instead of manufacturing a placeholder chunk -- a chunk whose
    text is just metadata about the file (`"[image/png content, N bytes]"`)
    would still get embedded and indexed as if it were real, searchable
    content. A tenant would see the job as "indexed" with no error, then
    get zero real retrieval hits from it forever. Failing the job instead
    makes the gap visible where it actually matters: to the caller, not
    buried in a vector nobody will ever match against.
    """

    def __init__(self, content_type: str) -> None:
        self.content_type = content_type
        super().__init__(f"No text extraction is available for {content_type}")


class ChunkSplitter(Protocol):
    def split(self, *, content: bytes, content_type: str) -> tuple[Chunk, ...]: ...


class ParagraphAwareChunkSplitter:
    """Real, disclosed chunking -- not a placeholder.

    text-like content (text/plain, application/json's canonical form):
    splits on blank-line paragraph boundaries, then greedily packs
    consecutive paragraphs into windows of at most `_MAX_CHUNK_CHARS`
    characters (never splitting a paragraph itself, so no chunk boundary
    lands mid-sentence). A single paragraph longer than the max is kept
    whole rather than cut, since a mid-paragraph cut would be worse for
    retrieval than one oversized chunk.

    application/pdf, image/png, image/jpeg: no real text-extraction exists
    anywhere in this repo (same disclosed limitation as normalization.py) --
    raises UnsupportedContentTypeError rather than indexing a placeholder.
    Real per-page/per-region chunking needs a PDF-text-extraction/OCR
    ticket first; the raw upload itself is still stored (pipeline.py keeps
    the object, only the chunk-and-index step is rejected).
    """

    def split(self, *, content: bytes, content_type: str) -> tuple[Chunk, ...]:
        if content_type not in _TEXT_LIKE_CONTENT_TYPES:
            # Never reinterpret raw binary bytes as text -- Postgres text
            # columns reject NUL bytes outright, and garbage-decoded binary
            # is not real chunk content anyway.
            raise UnsupportedContentTypeError(content_type)

        text = content.decode("utf-8")
        paragraphs = [p for p in text.split("\n\n") if p.strip()]
        if not paragraphs:
            return (Chunk(seq=0, text=text),)

        windows: list[str] = []
        current: list[str] = []
        current_len = 0
        for paragraph in paragraphs:
            paragraph_len = len(paragraph)
            if current and current_len + 2 + paragraph_len > _MAX_CHUNK_CHARS:
                windows.append("\n\n".join(current))
                current = []
                current_len = 0
            current.append(paragraph)
            current_len += paragraph_len + (2 if len(current) > 1 else 0)
        if current:
            windows.append("\n\n".join(current))

        # Merge a trailing undersized window into its predecessor rather than
        # emitting a near-empty final chunk -- only when there IS a
        # predecessor to merge into.
        if len(windows) > 1 and len(windows[-1]) < _MIN_CHUNK_CHARS:
            last = windows.pop()
            windows[-1] = windows[-1] + "\n\n" + last

        return tuple(Chunk(seq=index, text=window) for index, window in enumerate(windows))
