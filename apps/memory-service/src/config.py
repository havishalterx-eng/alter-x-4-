from functools import lru_cache

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    policy_db_url_sync: str = (
        "postgresql+psycopg2://memory_service:memory_local@localhost:5433/policy_db"
    )
    policy_db_system_url_sync: str = (
        "postgresql+psycopg2://policy_system_writer@localhost:5433/policy_db"
    )
    orchestration_service_base_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:3000")
    orchestration_service_timeout_seconds: float = Field(default=5.0, gt=0, le=30)
    intelligence_service_base_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:8000")
    intelligence_service_timeout_seconds: float = Field(default=5.0, gt=0, le=30)
    ads_core_base_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:8000")
    ads_core_timeout_seconds: float = Field(default=5.0, gt=0, le=30)
    cost_ledger_service_base_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:8000")
    cost_ledger_service_timeout_seconds: float = Field(default=5.0, gt=0, le=30)
    drift_failure_threshold: float = Field(default=0.2, ge=0, le=1)
    drift_window_size: int = Field(default=20, ge=2, le=100)
    # gt=0, not ge=0: DriftDetector rejects a significance_level of exactly
    # 0 (would mean "never statistically significant", not a real gate).
    drift_significance_level: float = Field(default=0.05, gt=0, le=1)

    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
