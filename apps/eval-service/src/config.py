from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# eval_db is created inside the engine-db cluster on 5433 by
# infrastructure/local/engine-db-init.sh. The previous default named port 5432,
# which is platform-db and has no eval_db, so the default could not connect.
#
# Exported as a constant so alembic/env.py can reach the database URL without
# constructing Settings, which would additionally require every runtime service
# address below.
DEFAULT_EVAL_DB_URL_SYNC = "postgresql+psycopg2://eval_service:eval_local@localhost:5433/eval_db"


class Settings(BaseSettings):
    eval_db_url_sync: str = DEFAULT_EVAL_DB_URL_SYNC
    grpc_bind_address: str = "0.0.0.0:50062"
    verification_grpc_target: str
    planner_base_url: str
    retrieval_grpc_target: str
    intent_grpc_target: str
    security_eval_base_url: str
    upload_eval_base_url: str
    tenant_isolation_retrieval_grpc_target: str
    toolgw_grpc_target: str
    recovery_grpc_target: str
    trigger_registry_base_url: str
    credential_base_url: str
    tool_consume_grpc_target: str
    idempotency_tenant_a_base_url: str
    idempotency_tenant_b_base_url: str
    ingestion_base_url: str
    policy_base_url: str
    run_visibility_base_url: str
    model_gateway_grpc_target: str
    verification_severity_grpc_target: str
    audit_grpc_target: str
    memory_drift_base_url: str
    workflow_base_url: str
    agent_binding_base_url: str
    project_base_url: str
    orchestration_db_url: str
    platform_db_url: str
    ads_db_url: str
    policy_db_url: str
    intelligence_db_url: str
    auth0_m2m_token_url: str
    auth0_m2m_audience: str
    auth0_m2m_client_id: str
    auth0_m2m_client_secret: str
    internal_service_token: str

    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    # Settings reads these required service targets from the environment.
    return Settings()  # type: ignore[call-arg]
