from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ads_db_url: str = "postgresql+asyncpg://ads_core:ads_core_local@localhost:5434/ads_db"
    ads_db_url_sync: str = "postgresql+psycopg2://ads_core:ads_core_local@localhost:5434/ads_db"
    # Dedicated BYPASSRLS connection used only by the authenticated internal
    # deletion API to enumerate subjects and perform cross-tenant retention.
    # Production injects this connection string from the existing secrets path.
    ads_deletion_db_url_sync: str = (
        "postgresql+psycopg2://ads_deletion:ads_deletion_local@localhost:5434/ads_db"
    )
    ads_ingestion_max_content_bytes: int = 25 * 1024 * 1024
    ads_ingestion_allowed_mime_types: str = (
        "application/json,text/plain,application/pdf,image/png,image/jpeg"
    )
    ads_ingestion_stub_bad_signatures: str = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE"
    deletion_service_token_sha256: str = Field(default="", min_length=64, max_length=64)
    model_gateway_grpc_target: str = "localhost:50051"
    auth0_m2m_token_url: str = ""
    auth0_m2m_audience: str = ""
    auth0_m2m_client_id: str = ""
    auth0_m2m_client_secret: str = ""

    # KNOW-6: presigned uploads. Empty bucket name (default) means "no real
    # AWS/S3 config present" -- the app wires InMemoryObjectStorageProvider
    # in that case, never assumes credentials exist. Setting a bucket name
    # (and optionally an endpoint_url for LocalStack) is required to
    # activate the real S3ObjectStorageProvider.
    ads_uploads_bucket_name: str = ""
    ads_uploads_s3_endpoint_url: str | None = None
    ads_uploads_s3_region: str = "ap-south-1"
    ads_uploads_presign_expiry_seconds: int = 900
    ads_connectors_secrets_region: str | None = None
    ads_q_max_concurrency: int = Field(default=16, ge=1, le=128)

    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        case_sensitive=False,
        validate_default=True,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
