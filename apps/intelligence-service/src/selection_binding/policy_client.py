"""Minimal read client for memory-service's active routing policy."""

from __future__ import annotations

import json
import math
from typing import Protocol

import httpx


class RoutingPolicyClient(Protocol):
    async def similarity_weight(self, tenant_id: str) -> float | None: ...


class HttpRoutingPolicyClient:
    def __init__(
        self,
        base_url: str,
        authorization: str,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._client = client or httpx.AsyncClient(
            base_url=base_url,
            timeout=3.0,
            headers={"Authorization": authorization},
        )

    async def similarity_weight(self, tenant_id: str) -> float | None:
        response = await self._client.post(
            "/memory/active-policy",
            json={"tenant_id": tenant_id, "kind": "routing_weights"},
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("found") is not True:
            return None
        body_json = payload.get("body_json")
        if not isinstance(body_json, str):
            return None
        body = json.loads(body_json)
        weight = body.get("similarity_weight") if isinstance(body, dict) else None
        if isinstance(weight, bool) or not isinstance(weight, (int, float)):
            return None
        value = float(weight)
        return value if math.isfinite(value) and 0.0 <= value <= 1.0 else None

    async def close(self) -> None:
        await self._client.aclose()
