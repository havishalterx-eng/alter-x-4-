from __future__ import annotations

from pathlib import Path

import pytest

from src.config import Settings

# Every required field, so the only variable under test is how Settings treats
# a key it does not declare.
_REQUIRED = {
    "VERIFICATION_GRPC_TARGET": "127.0.0.1:50054",
    "PLANNER_BASE_URL": "http://127.0.0.1:8000",
    "RETRIEVAL_GRPC_TARGET": "127.0.0.1:50070",
    "INTENT_GRPC_TARGET": "127.0.0.1:50071",
    "SECURITY_EVAL_BASE_URL": "http://127.0.0.1:8001",
    "UPLOAD_EVAL_BASE_URL": "http://127.0.0.1:8002",
    "TENANT_ISOLATION_RETRIEVAL_GRPC_TARGET": "127.0.0.1:50072",
    "TOOLGW_GRPC_TARGET": "127.0.0.1:50055",
    "RECOVERY_GRPC_TARGET": "127.0.0.1:50058",
    "TRIGGER_REGISTRY_BASE_URL": "http://127.0.0.1:3010",
    "CREDENTIAL_BASE_URL": "http://127.0.0.1:3010",
    "TOOL_CONSUME_GRPC_TARGET": "127.0.0.1:50055",
    "IDEMPOTENCY_TENANT_A_BASE_URL": "http://127.0.0.1:3010",
    "IDEMPOTENCY_TENANT_B_BASE_URL": "http://127.0.0.1:3010",
    "INGESTION_BASE_URL": "http://127.0.0.1:3010",
    "POLICY_BASE_URL": "http://127.0.0.1:3011",
    "RUN_VISIBILITY_BASE_URL": "http://127.0.0.1:3010",
    "MODEL_GATEWAY_GRPC_TARGET": "127.0.0.1:50051",
    "VERIFICATION_SEVERITY_GRPC_TARGET": "127.0.0.1:50054",
    "AUDIT_GRPC_TARGET": "127.0.0.1:50051",
    "MEMORY_DRIFT_BASE_URL": "http://127.0.0.1:3011",
    "WORKFLOW_BASE_URL": "http://127.0.0.1:3010",
    "AGENT_BINDING_BASE_URL": "http://127.0.0.1:8000",
    "PROJECT_BASE_URL": "http://127.0.0.1:3010",
    "ORCHESTRATION_DB_URL": "postgresql://u:p@127.0.0.1:5433/orchestration_db",
    "PLATFORM_DB_URL": "postgresql://u:p@127.0.0.1:5432/platform_db",
    "ADS_DB_URL": "postgresql://u:p@127.0.0.1:5434/ads_db",
    "POLICY_DB_URL": "postgresql://u:p@127.0.0.1:5433/policy_db",
    "INTELLIGENCE_DB_URL": "postgresql://u:p@127.0.0.1:5433/intelligence_db",
    "AUTH0_M2M_TOKEN_URL": "http://127.0.0.1:4999/oauth/token",
    "AUTH0_M2M_AUDIENCE": "https://engine.alter.local",
    "AUTH0_M2M_CLIENT_ID": "local-client",
    "AUTH0_M2M_CLIENT_SECRET": "local-secret",
    "INTERNAL_SERVICE_TOKEN": "integration-token",
}

# Keys belonging to other services, of the kind the shared .env.local always
# carries alongside this service's own.
_OTHER_SERVICES = [
    "PLATFORM_DB_PASSWORD=belongs-to-platform-api",
    "MEMORY_DB_URL_SYNC=belongs-to-memory-service",
    "ORCHESTRATION_GRPC_BIND_ADDRESS=0.0.0.0:50059",
]


def _write_env_file(directory: Path, entries: list[str]) -> Path:
    path = directory / ".env.local"
    path.write_text("\n".join(entries), encoding="utf-8")
    return path


def test_settings_ignore_variables_belonging_to_other_services(tmp_path: Path) -> None:
    """.env.local is shared, so it always carries other services' variables.

    Rejecting them reported 113 errors about configuration this service does
    not own before reporting one about configuration it does.
    """
    entries = [f"{name}={value}" for name, value in _REQUIRED.items()] + _OTHER_SERVICES

    settings = Settings(_env_file=_write_env_file(tmp_path, entries))  # type: ignore[call-arg]

    assert settings.model_gateway_grpc_target == "127.0.0.1:50051"


def test_settings_still_report_their_own_missing_fields(tmp_path: Path) -> None:
    """Ignoring another service's keys must not silence this service's own."""
    entries = [
        f"{name}={value}"
        for name, value in _REQUIRED.items()
        if name != "MODEL_GATEWAY_GRPC_TARGET"
    ] + _OTHER_SERVICES

    with pytest.raises(ValueError, match="model_gateway_grpc_target"):
        Settings(_env_file=_write_env_file(tmp_path, entries))  # type: ignore[call-arg]
