from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    intelligence_db_url: str = "postgresql+asyncpg://intelligence_service:intelligence_local@localhost:5433/intelligence_db"
    intelligence_db_url_sync: str = "postgresql+psycopg2://intelligence_service:intelligence_local@localhost:5433/intelligence_db"
    adsq_grpc_target: str = "localhost:50057"
    adsq_grpc_timeout_seconds: float = 3.0

    model_config = SettingsConfigDict(
        env_file=".env.local",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
