from functools import lru_cache

from pydantic import AnyHttpUrl, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    policy_db_url_sync: str = (
        "postgresql+psycopg2://memory_service:memory_local@localhost:5433/policy_db"
    )
    orchestration_service_base_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:3000")
    orchestration_service_timeout_seconds: float = Field(default=5.0, gt=0, le=30)

    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
