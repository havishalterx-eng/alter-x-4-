"""Minimal read client for memory-service's active quality_thresholds policy."""

from __future__ import annotations

import json
import math
from typing import Protocol

import httpx


class QualityThresholdPolicyClient(Protocol):
    async def quality_threshold(self, tenant_id: str) -> tuple[float, float] | None: ...


class HttpQualityThresholdPolicyClient:
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

    async def quality_threshold(self, tenant_id: str) -> tuple[float, float] | None:
        """Returns (threshold, warn_margin) from the real active policy, or
        None if no row exists / the body doesn't hold two finite [0, 1]
        values -- callers fall back to their own hardcoded defaults, same
        as HttpRoutingPolicyClient.similarity_weight's failure shape."""
        response = await self._client.post(
            "/memory/active-policy",
            json={"tenant_id": tenant_id, "kind": "quality_thresholds"},
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("found") is not True:
            return None
        body_json = payload.get("body_json")
        if not isinstance(body_json, str):
            return None
        body = json.loads(body_json)
        if not isinstance(body, dict):
            return None
        threshold = body.get("threshold")
        warn_margin = body.get("warn_margin")
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
            return None
        if isinstance(warn_margin, bool) or not isinstance(warn_margin, (int, float)):
            return None
        threshold_value = float(threshold)
        warn_margin_value = float(warn_margin)
        if not (math.isfinite(threshold_value) and 0.0 <= threshold_value <= 1.0):
            return None
        if not (math.isfinite(warn_margin_value) and 0.0 <= warn_margin_value <= 1.0):
            return None
        return threshold_value, warn_margin_value

    async def close(self) -> None:
        await self._client.aclose()
