from __future__ import annotations

from typing import Protocol

import httpx


class AdsCoreMemoryDeliveryUnavailableError(RuntimeError):
    pass


class AdsCoreMemoryClient(Protocol):
    async def record_memory_namespace(
        self,
        *,
        tenant_id: str,
        scope_id: str,
        kind: str,
        statement: str,
        confidence: float | None,
        provenance: dict[str, object],
        authorization: str,
    ) -> str: ...


class HttpxAdsCoreMemoryClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None

    async def record_memory_namespace(
        self,
        *,
        tenant_id: str,
        scope_id: str,
        kind: str,
        statement: str,
        confidence: float | None,
        provenance: dict[str, object],
        authorization: str,
    ) -> str:
        try:
            response = await self._client.post(
                f"{self._base_url}/ads/memory-namespace/records",
                json={
                    "tenant_id": tenant_id,
                    "scope_id": scope_id,
                    "kind": kind,
                    "statement": statement,
                    "confidence": confidence,
                    "provenance": provenance,
                },
                headers={"authorization": authorization},
            )
        except httpx.HTTPError as error:
            raise AdsCoreMemoryDeliveryUnavailableError(
                "ADS Core memory-namespace request failed"
            ) from error
        if not response.is_success:
            raise AdsCoreMemoryDeliveryUnavailableError(
                f"ADS Core memory-namespace request failed with status {response.status_code}"
            )
        body = response.json()
        record_id = body.get("id") if isinstance(body, dict) else None
        if not isinstance(record_id, str) or not record_id:
            raise AdsCoreMemoryDeliveryUnavailableError(
                "ADS Core memory-namespace response is missing a real id"
            )
        return record_id

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()
