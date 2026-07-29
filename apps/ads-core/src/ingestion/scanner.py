from __future__ import annotations

from typing import Protocol

from .models import ScanResult


class ContentScanner(Protocol):
    def scan(self, *, content: bytes, content_type: str) -> ScanResult: ...


class DisclosedStubScanner:
    """Signature-only scanner that never claims to provide antivirus coverage."""

    _LIMITATIONS = (
        "signature_only",
        "no_antivirus_engine",
        "no_archive_expansion",
    )

    def __init__(self, known_bad_signatures: tuple[bytes, ...]) -> None:
        if not known_bad_signatures or any(not signature for signature in known_bad_signatures):
            raise ValueError("At least one non-empty known-bad signature is required")
        self._known_bad_signatures = known_bad_signatures

    def scan(self, *, content: bytes, content_type: str) -> ScanResult:
        del content_type
        if any(signature in content for signature in self._known_bad_signatures):
            return ScanResult(
                accepted=False,
                scanned_by="stub",
                limitations=self._LIMITATIONS,
                error_code="known_bad_signature",
            )
        return ScanResult(
            accepted=True,
            scanned_by="stub",
            limitations=self._LIMITATIONS,
        )
