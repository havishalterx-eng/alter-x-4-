"""Real HTTP client to intelligence-service's PlannerService (HARD-7b).

PlannerService is defined as a gRPC contract in alter/planner/v1/planner.proto,
but intelligence-service's actual transport is HTTP/FastAPI mirroring the RPC
names 1:1 (see apps/intelligence-service/src/planner/router.py's own module
doc). This client talks to that real HTTP surface, not a mocked one.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class SelectStrategyResult:
    strategy: str
    reason: str


class PlannerClient:
    def __init__(self, base_url: str, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._client = httpx.Client(base_url=base_url, timeout=timeout_seconds)

    def select_strategy(self, *, tenant_id: str, objective: str, mode: str) -> SelectStrategyResult:
        response = self._client.post(
            "/planner/select-strategy",
            json={"tenant_id": tenant_id, "objective": objective, "mode": mode},
        )
        response.raise_for_status()
        body = response.json()
        return SelectStrategyResult(strategy=body["strategy"], reason=body["reason"])

    def close(self) -> None:
        self._client.close()
