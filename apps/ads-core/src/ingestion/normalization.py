from __future__ import annotations

import hashlib
import json
import unicodedata
from dataclasses import dataclass
from typing import Protocol

_TEXT_LIKE_CONTENT_TYPES = frozenset({"text/plain", "application/json"})


@dataclass(frozen=True)
class NormalizedContent:
    content_hash: str
    normalized_by: str
    limitations: tuple[str, ...]


class ContentNormalizer(Protocol):
    def normalize(self, *, content: bytes, content_type: str) -> NormalizedContent: ...


class TextAwareNormalizer:
    """Real normalization for text-shaped content; honest pass-through for binary.

    text/plain: Unicode NFC, CRLF/CR -> LF, trailing whitespace stripped per line,
    3+ consecutive blank lines collapsed to 1, leading/trailing whitespace trimmed.
    Deliberately does NOT collapse all whitespace to single spaces -- that would
    destroy paragraph structure KNOW-5's chunker will need later.

    application/json: canonically re-serialized (sorted keys, compact separators)
    so two uploads of the same JSON with different formatting/key order normalize
    to identical bytes.

    application/pdf, image/png, image/jpeg: no real text-normalization exists in
    this ticket -- no PDF-text-extraction or OCR dependency is wired anywhere in
    this repo yet. Content hash is computed over the raw bytes unchanged, and the
    limitation is recorded rather than hidden.
    """

    def normalize(self, *, content: bytes, content_type: str) -> NormalizedContent:
        if content_type == "application/json":
            decoded = content.decode("utf-8")
            canonical = json.dumps(json.loads(decoded), sort_keys=True, separators=(",", ":"))
            normalized_bytes = canonical.encode("utf-8")
            return NormalizedContent(
                content_hash=hashlib.sha256(normalized_bytes).hexdigest(),
                normalized_by="json-canonical-v1",
                limitations=(),
            )
        if content_type == "text/plain":
            decoded = content.decode("utf-8")
            normalized_text = _normalize_text(decoded)
            normalized_bytes = normalized_text.encode("utf-8")
            return NormalizedContent(
                content_hash=hashlib.sha256(normalized_bytes).hexdigest(),
                normalized_by="text-nfc-lines-v1",
                limitations=(),
            )
        return NormalizedContent(
            content_hash=hashlib.sha256(content).hexdigest(),
            normalized_by="passthrough",
            limitations=("no_text_extraction_for_binary_content",),
        )


def _normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    collapsed: list[str] = []
    blank_run = 0
    for line in lines:
        if line == "":
            blank_run += 1
            if blank_run > 1:
                continue
        else:
            blank_run = 0
        collapsed.append(line)
    return "\n".join(collapsed).strip()
