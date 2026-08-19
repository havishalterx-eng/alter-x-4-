import secrets
import time
import uuid

# Real sentinel tenant representing "the platform, not a real tenant" --
# established by capability_registry_versions (2026-08 registry build) for
# scope='global' rows; agents (0005_global_agents) reuses the same value
# rather than inventing a second sentinel for the same concept.
PLATFORM_TENANT_ID = "00000000-0000-7000-8000-000000000001"

_PREFIX_MAP = {
    "agt": "agt",
    "agtv": "agtv",
    "cemb": "cemb",
    "perf": "perf",
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
