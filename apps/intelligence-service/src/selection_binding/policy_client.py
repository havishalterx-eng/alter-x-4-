"""Minimal read client for memory-service's active routing policy."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass(frozen=True)
class RoutingWeights:
    """The weights the active routing_weights policy sets, if it sets them.

    Every field is independently optional: a policy body written before a
    weight existed does not carry it, and the engine keeps its own default for
    that one rather than treating the whole policy as missing.
    """

    similarity_weight: float | None = None
    efficiency_weight: float | None = None


class RoutingPolicyClient(Protocol):
    async def routing_weights(self, tenant_id: str) -> RoutingWeights | None: ...


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

    async def routing_weights(self, tenant_id: str) -> RoutingWeights | None:
        """One request for the whole policy body.

        Both weights live in the same `routing_weights` document, so asking
        per weight would put a second HTTP round trip on the per-node binding
        path to read a field of a body already in hand.
        """
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
        if not isinstance(body, dict):
            return None
        return RoutingWeights(
            similarity_weight=_unit_interval(body.get("similarity_weight")),
            efficiency_weight=_unit_interval(body.get("efficiency_weight")),
        )

    async def close(self) -> None:
        await self._client.aclose()


def _unit_interval(value: object) -> float | None:
    # bool is an int in Python, so `true` in a policy body would otherwise
    # read as a weight of 1.0 rather than as the malformed value it is.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    weight = float(value)
    return weight if math.isfinite(weight) and 0.0 <= weight <= 1.0 else None
