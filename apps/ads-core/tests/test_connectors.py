import base64
import hashlib
import hmac
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Literal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.connectors.dispatcher import ConnectorSyncService
from src.connectors.models import ConnectorSource
from src.connectors.providers import ConnectorSyncError, FirstPartyConnectorClient
from src.connectors.repository import ConnectorSourceRepository, _forbidden_config_key
from src.connectors.router import get_connector_service, router
from src.ingestion.models import IngestionJobResponse, IngestionPayload

TENANT_ID = "ten_00000000-0000-7000-8000-000000000001"
SOURCE_ID = "src_00000000-0000-7000-8000-000000000002"


class FakePipeline:
    def __init__(self) -> None:
        self.payloads: list[IngestionPayload] = []

    def ingest(self, payload: IngestionPayload) -> IngestionJobResponse:
        self.payloads.append(payload)
        return IngestionJobResponse(
            ingestion_job_id="ing_00000000-0000-7000-8000-000000000003",
            source_id=payload.source_id,
            stage="received",
            stats={},
            error=None,
            created_at=datetime.now(UTC),
            completed_at=None,
        )


class FakeSources(ConnectorSourceRepository):
    def __init__(self, source: ConnectorSource) -> None:
        self.source = source
        self.synchronized = False

    def get(self, *, tenant_id: str, source_id: str) -> ConnectorSource:
        assert tenant_id == self.source.tenant_id
        assert source_id == self.source.id
        return self.source

    def mark_synchronized(self, *, tenant_id: str, source_id: str) -> None:
        assert tenant_id == self.source.tenant_id
        assert source_id == self.source.id
        self.synchronized = True


class FakeCredentials:
    def __init__(self, values: dict[str, object]) -> None:
        self.values = values
        self.references: list[str] = []

    def resolve(self, reference: str) -> dict[str, object]:
        self.references.append(reference)
        return self.values


class FakeHttp:
    def __init__(self, responses: list[tuple[bytes, str]]) -> None:
        self.responses = responses
        self.urls: list[str] = []

    def get(self, url: str, headers: Mapping[str, str]) -> tuple[bytes, str]:
        del headers
        self.urls.append(url)
        return self.responses.pop(0)


def source(provider: Literal["shopify", "google_drive"]) -> ConnectorSource:
    config: dict[str, object] = (
        {"shop_domain": "shop.example"}
        if provider == "shopify"
        else {"folder_id": "folder-1"}
    )
    return ConnectorSource(
        id=SOURCE_ID,
        tenant_id=TENANT_ID,
        provider=provider,
        integration_ref="00000000-0000-7000-8000-000000000004",
        credential_ref="/alter/credentials/00000000-0000-7000-8000-000000000001/connector",
        sync_config=config,
    )


def test_scheduled_shopify_sync_pulls_and_creates_ingestion_jobs() -> None:
    pipeline = FakePipeline()
    http = FakeHttp([(b'{"products":[{"id":11,"title":"Widget"}]}', "application/json")])
    service = ConnectorSyncService(
        pipeline=pipeline,  # type: ignore[arg-type]
        sources=FakeSources(source("shopify")),
        providers=FirstPartyConnectorClient(
            credentials=FakeCredentials({"access_token": "secret"}), http=http
        ),
    )

    jobs = service.scheduled_sync(tenant_id=TENANT_ID, source_id=SOURCE_ID)

    assert len(jobs) == 1
    assert pipeline.payloads[0].content_type == "application/json"
    assert b"Widget" in pipeline.payloads[0].content
    assert http.urls == ["https://shop.example/admin/api/2025-01/products.json?limit=250"]


def test_scheduled_drive_sync_downloads_folder_files() -> None:
    pipeline = FakePipeline()
    http = FakeHttp(
        [
            (b'{"files":[{"id":"file-1","mimeType":"text/plain"}]}', "application/json"),
            (b"drive content", "text/plain"),
        ]
    )
    service = ConnectorSyncService(
        pipeline=pipeline,  # type: ignore[arg-type]
        sources=FakeSources(source("google_drive")),
        providers=FirstPartyConnectorClient(
            credentials=FakeCredentials({"access_token": "secret"}), http=http
        ),
    )

    jobs = service.scheduled_sync(tenant_id=TENANT_ID, source_id=SOURCE_ID)

    assert len(jobs) == 1
    assert pipeline.payloads[0].content == b"drive content"
    assert "/drive/v3/files/file-1?alt=media" in http.urls[1]


def test_shopify_webhook_rejects_bad_signature() -> None:
    provider = FirstPartyConnectorClient(
        credentials=FakeCredentials({"access_token": "secret", "webhook_secret": "hook-secret"}),
        http=FakeHttp([]),
    )

    with pytest.raises(ConnectorSyncError, match="signature"):
        provider.verify_webhook(source("shopify"), headers={}, body=b"payload")


def test_shopify_webhook_triggers_pull_after_signature_verification() -> None:
    payload = b"payload"
    signature = base64.b64encode(
        hmac.new(b"hook-secret", payload, hashlib.sha256).digest()
    ).decode("ascii")
    pipeline = FakePipeline()
    service = ConnectorSyncService(
        pipeline=pipeline,  # type: ignore[arg-type]
        sources=FakeSources(source("shopify")),
        providers=FirstPartyConnectorClient(
            credentials=FakeCredentials(
                {"access_token": "secret", "webhook_secret": "hook-secret"}
            ),
            http=FakeHttp([(b'{"products":[{"id":11}]}', "application/json")]),
        ),
    )

    jobs = service.webhook_sync(
        tenant_id=TENANT_ID,
        source_id=SOURCE_ID,
        provider="shopify",
        headers={"x-shopify-hmac-sha256": signature},
        body=payload,
    )

    assert len(jobs) == 1
    assert len(pipeline.payloads) == 1


def test_connector_router_starts_scheduled_sync() -> None:
    pipeline = FakePipeline()
    service = ConnectorSyncService(
        pipeline=pipeline,  # type: ignore[arg-type]
        sources=FakeSources(source("shopify")),
        providers=FirstPartyConnectorClient(
            credentials=FakeCredentials({"access_token": "secret"}),
            http=FakeHttp([(b'{"products":[{"id":11}]}', "application/json")]),
        ),
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_connector_service] = lambda: service

    response = TestClient(app).post(
        f"/ads/sources/{SOURCE_ID}/actions/sync", headers={"X-Alter-Tenant-Id": TENANT_ID}
    )

    assert response.status_code == 202
    assert response.json()[0]["source_id"] == SOURCE_ID


def test_source_config_rejects_raw_secret_fields() -> None:
    assert _forbidden_config_key({"nested": {"access_token": "nope"}}) == "access_token"
    assert _forbidden_config_key({"credential_ref": "/alter/credentials/id"}) is None
