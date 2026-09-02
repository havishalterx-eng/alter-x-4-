import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from src.config import DEFAULT_EVAL_DB_URL_SYNC
from src.db.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
_PLACEHOLDER = "postgresql://placeholder"


def get_url() -> str:
    configured = config.get_main_option("sqlalchemy.url")
    if configured and configured != _PLACEHOLDER:
        return configured
    # A migration needs the database URL and nothing else. Calling
    # get_settings() here additionally required thirty runtime service
    # addresses -- verification_grpc_target, planner_base_url and the rest --
    # describing services a migration never contacts, which made this database
    # impossible to bootstrap. Read the one setting that is actually needed.
    return os.environ.get("EVAL_DB_URL_SYNC", DEFAULT_EVAL_DB_URL_SYNC)


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
