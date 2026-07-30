from dataclasses import dataclass
from typing import Literal

ConnectorProvider = Literal["shopify", "google_drive"]


@dataclass(frozen=True)
class ConnectorDocument:
    external_key: str
    content_type: str
    content: bytes


@dataclass(frozen=True)
class ConnectorSource:
    id: str
    tenant_id: str
    provider: ConnectorProvider
    integration_ref: str
    credential_ref: str
    sync_config: dict[str, object]
