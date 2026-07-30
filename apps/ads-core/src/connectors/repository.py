from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol, cast

from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from src.db.ids import validate_prefixed_id
from src.db.models import Source

from .models import ConnectorProvider, ConnectorSource

_SET_TENANT = text("SELECT set_config('app.current_tenant_id', :tenant_id, true)")
_SUPPORTED_PROVIDERS = frozenset(("shopify", "google_drive"))
_FORBIDDEN_CONFIG_KEYS = frozenset(
    ("access_token", "api_key", "password", "secret", "token", "webhook_secret")
)


class ConnectorSourceNotFoundError(ValueError):
    pass


class ConnectorSourceRepository(Protocol):
    def get(self, *, tenant_id: str, source_id: str) -> ConnectorSource: ...

    def mark_synchronized(self, *, tenant_id: str, source_id: str) -> None: ...


class SqlAlchemyConnectorSourceRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def get(self, *, tenant_id: str, source_id: str) -> ConnectorSource:
        validate_prefixed_id("ten", tenant_id)
        validate_prefixed_id("src", source_id)
        tenant_uuid = tenant_id.removeprefix("ten_")
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            source = session.scalar(
                select(Source).where(Source.tenant_id == tenant_uuid, Source.id == source_id)
            )
            if source is None:
                raise ConnectorSourceNotFoundError(
                    "Connector source does not exist for requesting tenant"
                )
            return self._connector_source(source, tenant_id)

    def mark_synchronized(self, *, tenant_id: str, source_id: str) -> None:
        tenant_uuid = tenant_id.removeprefix("ten_")
        with self._sessions.begin() as session:
            self._set_tenant(session, tenant_uuid)
            source = session.scalar(
                select(Source).where(Source.tenant_id == tenant_uuid, Source.id == source_id)
            )
            if source is None:
                raise ConnectorSourceNotFoundError(
                    "Connector source does not exist for requesting tenant"
                )
            source.last_sync_at = datetime.now(UTC)

    @staticmethod
    def _set_tenant(session: Session, tenant_id: str) -> None:
        session.execute(_SET_TENANT, {"tenant_id": tenant_id})

    @staticmethod
    def _connector_source(source: Source, tenant_id: str) -> ConnectorSource:
        if source.kind != "connector" or source.provider not in _SUPPORTED_PROVIDERS:
            raise ValueError("Source is not a supported ADS connector")
        if source.integration_ref is None:
            raise ValueError("Connector source requires integration_ref")
        config = dict(cast(dict[str, object], source.sync_config or {}))
        forbidden = _forbidden_config_key(config)
        if forbidden is not None:
            raise ValueError(
                f"Connector source config must not contain raw secret field: {forbidden}"
            )
        credential_ref = config.pop("credential_ref", None)
        if not isinstance(credential_ref, str) or not credential_ref:
            raise ValueError("Connector source requires sync_config.credential_ref")
        expected_prefix = f"/alter/credentials/{tenant_id.removeprefix('ten_')}/"
        if not credential_ref.startswith(expected_prefix):
            raise ValueError("Connector credential_ref is not owned by the source tenant")
        return ConnectorSource(
            id=source.id,
            tenant_id=tenant_id,
            provider=cast(ConnectorProvider, source.provider),
            integration_ref=source.integration_ref,
            credential_ref=credential_ref,
            sync_config=config,
        )


def _forbidden_config_key(value: object) -> str | None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if isinstance(key, str) and key.lower() in _FORBIDDEN_CONFIG_KEYS:
                return key
            forbidden = _forbidden_config_key(nested)
            if forbidden is not None:
                return forbidden
    if isinstance(value, list):
        for nested in value:
            forbidden = _forbidden_config_key(nested)
            if forbidden is not None:
                return forbidden
    return None
