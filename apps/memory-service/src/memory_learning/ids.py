from __future__ import annotations

import secrets
import time
import uuid


def new_prefixed_uuid7(prefix: str) -> str:
    timestamp_ms = time.time_ns() // 1_000_000
    raw = bytearray(secrets.token_bytes(16))
    raw[0:6] = timestamp_ms.to_bytes(6, byteorder="big")
    raw[6] = (raw[6] & 0x0F) | 0x70
    raw[8] = (raw[8] & 0x3F) | 0x80
    return f"{prefix}_{uuid.UUID(bytes=bytes(raw))}"


def raw_uuid7(value: str, prefix: str) -> str:
    expected = f"{prefix}_"
    if not value.startswith(expected):
        raise ValueError(f"expected {expected} prefixed UUIDv7")
    try:
        parsed = uuid.UUID(value[len(expected) :])
    except ValueError as error:
        raise ValueError(f"expected {expected} prefixed UUIDv7") from error
    if parsed.version != 7:
        raise ValueError(f"expected {expected} prefixed UUIDv7")
    return str(parsed)
