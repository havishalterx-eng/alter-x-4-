import uuid

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


def new_prefixed_id(prefix: str) -> str:
    raw = str(uuid.uuid4())
    return f"{prefix}_{raw}"


def validate_prefixed_id(prefix: str, value: str) -> str:
    expected = f"{prefix}_"
    if not value.startswith(expected):
        raise ValueError(f"Expected id with prefix '{prefix}_', got: {value!r}")
    raw = value[len(expected):]
    if not _is_valid_uuid(raw):
        raise ValueError(f"Invalid UUID portion in prefixed id: {value!r}")
    return value
