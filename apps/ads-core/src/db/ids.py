import secrets
import time
import uuid

_PREFIX_MAP = {
    "scp": "scp",
    "src": "src",
    "doc": "doc",
    "chk": "chk",
    "brec": "brec",
    "mns": "mns",
    "ing": "ing",
    "rta": "rta",
}

_UUID_PATTERN_LEN = 36


def _is_valid_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


def new_prefixed_id(prefix: str, *, now_ms: int | None = None) -> str:
    """Create an Alter-prefixed UUIDv7 identifier without an external dependency."""

    timestamp_ms = time.time_ns() // 1_000_000 if now_ms is None else now_ms
    if timestamp_ms < 0 or timestamp_ms > 0xFFFFFFFFFFFF:
        raise ValueError("UUIDv7 timestamp is outside the 48-bit range")

    raw = bytearray(secrets.token_bytes(16))
    raw[0:6] = timestamp_ms.to_bytes(6, byteorder="big")
    raw[6] = (raw[6] & 0x0F) | 0x70
    raw[8] = (raw[8] & 0x3F) | 0x80
    return f"{prefix}_{uuid.UUID(bytes=bytes(raw))}"


def validate_prefixed_id(prefix: str, value: str) -> str:
    expected = f"{prefix}_"
    if not value.startswith(expected):
        raise ValueError(f"Expected id with prefix '{prefix}_', got: {value!r}")
    raw = value[len(expected):]
    if not _is_valid_uuid(raw):
        raise ValueError(f"Invalid UUID portion in prefixed id: {value!r}")
    return value
