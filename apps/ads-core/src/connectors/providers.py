from __future__ import annotations

import base64
import hashlib
import hmac
import json
from collections.abc import Mapping
from typing import Protocol, cast
from urllib.parse import quote
from urllib.request import Request, urlopen

import boto3

from .models import ConnectorDocument, ConnectorSource


class ConnectorSyncError(ValueError):
    pass


class CredentialResolver(Protocol):
    def resolve(self, reference: str) -> dict[str, object]: ...


class HttpClient(Protocol):
    def get(self, url: str, headers: Mapping[str, str]) -> tuple[bytes, str]: ...


class ConnectorProviderClient(Protocol):
    def pull(self, source: ConnectorSource) -> tuple[ConnectorDocument, ...]: ...

    def verify_webhook(
        self, source: ConnectorSource, *, headers: Mapping[str, str], body: bytes
    ) -> None: ...


class AwsSecretsManagerCredentialResolver:
    """Resolve opaque references at execution time; no secret reaches ADS storage."""

    def __init__(self, *, region_name: str | None = None) -> None:
        self._region_name = region_name

    def resolve(self, reference: str) -> dict[str, object]:
        # Do not construct an AWS client while ADS boots. Connector credentials
        # are optional, and a service without connector configuration must still
        # serve uploads, deletion, and health checks.
        response = boto3.client(
            "secretsmanager", region_name=self._region_name
        ).get_secret_value(SecretId=reference)
        raw = response.get("SecretString")
        if not isinstance(raw, str):
            binary = response.get("SecretBinary")
            if isinstance(binary, bytes):
                raw = binary.decode("utf-8")
        if not isinstance(raw, str):
            raise ConnectorSyncError("Credential reference resolved to no string secret")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ConnectorSyncError("Connector credential must be a JSON object") from exc
        if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
            raise ConnectorSyncError("Connector credential must be a JSON object")
        return cast(dict[str, object], value)


class UrlLibHttpClient:
    def get(self, url: str, headers: Mapping[str, str]) -> tuple[bytes, str]:
        request = Request(url, headers=dict(headers), method="GET")
        with urlopen(request, timeout=30) as response:  # noqa: S310 - URLs derive from validated source config.
            content_type = response.headers.get_content_type()
            return response.read(), content_type


class FirstPartyConnectorClient:
    def __init__(self, *, credentials: CredentialResolver, http: HttpClient) -> None:
        self._credentials = credentials
        self._http = http

    def pull(self, source: ConnectorSource) -> tuple[ConnectorDocument, ...]:
        credential = self._credentials.resolve(source.credential_ref)
        if source.provider == "shopify":
            return self._pull_shopify(source, credential)
        return self._pull_google_drive(source, credential)

    def verify_webhook(
        self, source: ConnectorSource, *, headers: Mapping[str, str], body: bytes
    ) -> None:
        credential = self._credentials.resolve(source.credential_ref)
        if source.provider == "shopify":
            secret = _required_string(credential, "webhook_secret")
            received = headers.get("x-shopify-hmac-sha256", "")
            expected = base64.b64encode(
                hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
            ).decode("ascii")
            if not hmac.compare_digest(received, expected):
                raise ConnectorSyncError("Shopify webhook signature is invalid")
            return
        expected = _required_string(credential, "webhook_token")
        if not hmac.compare_digest(headers.get("x-goog-channel-token", ""), expected):
            raise ConnectorSyncError("Google Drive webhook token is invalid")

    def _pull_shopify(
        self, source: ConnectorSource, credential: dict[str, object]
    ) -> tuple[ConnectorDocument, ...]:
        domain = _required_config_string(source, "shop_domain").removesuffix("/")
        if "://" in domain or "/" in domain:
            raise ConnectorSyncError("shop_domain must be a hostname")
        token = _required_string(credential, "access_token")
        content, _ = self._http.get(
            f"https://{domain}/admin/api/2025-01/products.json?limit=250",
            {"X-Shopify-Access-Token": token, "Accept": "application/json"},
        )
        payload = _json_object(content, "Shopify products response")
        products = payload.get("products")
        if not isinstance(products, list):
            raise ConnectorSyncError("Shopify products response did not include products")
        return tuple(
            ConnectorDocument(
                external_key=f"shopify-product:{product_id}",
                content_type="application/json",
                content=json.dumps(product, separators=(",", ":")).encode("utf-8"),
            )
            for product in products
            if isinstance(product, dict)
            if (product_id := product.get("id")) is not None
        )

    def _pull_google_drive(
        self, source: ConnectorSource, credential: dict[str, object]
    ) -> tuple[ConnectorDocument, ...]:
        folder_id = _required_config_string(source, "folder_id")
        token = _required_string(credential, "access_token")
        query = quote(f"'{folder_id}' in parents and trashed = false", safe="")
        content, _ = self._http.get(
            "https://www.googleapis.com/drive/v3/files"
            f"?q={query}&fields=files(id,name,mimeType,modifiedTime)",
            {"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        files = _json_object(content, "Google Drive files response").get("files")
        if not isinstance(files, list):
            raise ConnectorSyncError("Google Drive files response did not include files")
        documents: list[ConnectorDocument] = []
        for file in files:
            if not isinstance(file, dict):
                continue
            file_id = file.get("id")
            mime_type = file.get("mimeType")
            if not isinstance(file_id, str) or not isinstance(mime_type, str):
                continue
            url = f"https://www.googleapis.com/drive/v3/files/{quote(file_id, safe='')}?alt=media"
            if mime_type.startswith("application/vnd.google-apps"):
                url = (
                    f"https://www.googleapis.com/drive/v3/files/{quote(file_id, safe='')}/export"
                    "?mimeType=text/plain"
                )
            body, content_type = self._http.get(
                url, {"Authorization": f"Bearer {token}", "Accept": "text/plain,application/json"}
            )
            documents.append(
                ConnectorDocument(
                    external_key=f"google-drive:{file_id}",
                    content_type=content_type,
                    content=body,
                )
            )
        return tuple(documents)


def _required_config_string(source: ConnectorSource, key: str) -> str:
    value = source.sync_config.get(key)
    if not isinstance(value, str) or not value:
        raise ConnectorSyncError(f"Connector source requires sync_config.{key}")
    return value


def _required_string(value: Mapping[str, object], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item:
        raise ConnectorSyncError(f"Connector credential requires {key}")
    return item


def _json_object(content: bytes, label: str) -> dict[str, object]:
    try:
        payload = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConnectorSyncError(f"{label} was not valid JSON") from exc
    if not isinstance(payload, dict):
        raise ConnectorSyncError(f"{label} was not a JSON object")
    return cast(dict[str, object], payload)
