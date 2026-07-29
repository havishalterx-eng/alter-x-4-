from __future__ import annotations

import json
from dataclasses import dataclass

_SUPPORTED_CONTENT_TYPES = frozenset(
    {"application/json", "text/plain", "application/pdf", "image/png", "image/jpeg"}
)


class PayloadValidationError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class PayloadValidator:
    max_content_bytes: int
    allowed_content_types: frozenset[str]

    def __post_init__(self) -> None:
        if self.max_content_bytes <= 0:
            raise ValueError("max_content_bytes must be positive")
        if not self.allowed_content_types:
            raise ValueError("allowed_content_types must not be empty")
        unsupported = self.allowed_content_types - _SUPPORTED_CONTENT_TYPES
        if unsupported:
            raise ValueError(f"Unsupported content validators configured: {sorted(unsupported)}")

    def validate(self, *, content: bytes, content_type: str) -> None:
        if content_type not in self.allowed_content_types:
            raise PayloadValidationError(
                "content_type_not_allowed",
                "Declared content type is not in the upload allowlist",
            )
        if not content:
            raise PayloadValidationError("empty_content", "Content must not be empty")
        if len(content) > self.max_content_bytes:
            raise PayloadValidationError(
                "content_too_large",
                f"Content exceeds configured {self.max_content_bytes}-byte limit",
            )

        validators = {
            "application/json": self._validate_json,
            "text/plain": self._validate_text,
            "application/pdf": self._validate_pdf,
            "image/png": self._validate_png,
            "image/jpeg": self._validate_jpeg,
        }
        validators[content_type](content)

    @staticmethod
    def _decode_utf8(content: bytes, kind: str) -> str:
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise PayloadValidationError(
                "malformed_content", f"Declared {kind} content is not valid UTF-8"
            ) from exc

    @classmethod
    def _validate_json(cls, content: bytes) -> None:
        decoded = cls._decode_utf8(content, "JSON")
        try:
            json.loads(decoded)
        except json.JSONDecodeError as exc:
            raise PayloadValidationError(
                "malformed_content", "Declared JSON content is not well formed"
            ) from exc

    @classmethod
    def _validate_text(cls, content: bytes) -> None:
        cls._decode_utf8(content, "text")

    @staticmethod
    def _validate_pdf(content: bytes) -> None:
        if not content.startswith(b"%PDF-") or not content.rstrip().endswith(b"%%EOF"):
            raise PayloadValidationError(
                "malformed_content", "Declared PDF content has invalid framing"
            )

    @staticmethod
    def _validate_png(content: bytes) -> None:
        if not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise PayloadValidationError(
                "malformed_content", "Declared PNG content has an invalid signature"
            )

    @staticmethod
    def _validate_jpeg(content: bytes) -> None:
        if not content.startswith(b"\xff\xd8\xff") or not content.endswith(b"\xff\xd9"):
            raise PayloadValidationError(
                "malformed_content", "Declared JPEG content has invalid framing"
            )
