"""Real HTTP client to intelligence-service's PlannerService (HARD-7b/7h).

PlannerService is defined as a gRPC contract in alter/planner/v1/planner.proto,
but intelligence-service's actual transport is HTTP/FastAPI mirroring the RPC
names 1:1 (see apps/intelligence-service/src/planner/router.py's own module
doc). This client talks to that real HTTP surface, not a mocked one.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import httpx

DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class SelectStrategyResult:
    strategy: str
    reason: str


@dataclass(frozen=True)
class DecomposeResult:
    stage_count: int
    entry_point: str
    stages: list[str]
    ambiguity_detected: bool


class PlannerClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        *,
        service_token: str = "",
    ) -> None:
        # Same optional-credential convention as IngestionEvalClient: attach
        # the internal service credential when one is configured so the
        # callee's app-level service auth accepts the call.
        headers = {"Authorization": f"Bearer {service_token}"} if service_token else None
        self._client = httpx.Client(base_url=base_url, timeout=timeout_seconds, headers=headers)

    def select_strategy(self, *, tenant_id: str, objective: str, mode: str) -> SelectStrategyResult:
        response = self._client.post(
            "/planner/select-strategy",
            json={"tenant_id": tenant_id, "objective": objective, "mode": mode},
        )
        response.raise_for_status()
        body = response.json()
        return SelectStrategyResult(strategy=body["strategy"], reason=body["reason"])

    def decompose(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        run_id: str,
        problem_spec_json: str,
        strategy: str,
    ) -> DecomposeResult:
        response = self._client.post(
            "/planner/decompose",
            json={
                "tenant_id": tenant_id,
                "workspace_id": workspace_id,
                "run_id": run_id,
                "strategy": strategy,
                "problem_spec_json": problem_spec_json,
            },
        )
        response.raise_for_status()
        body = response.json()
        skeleton = json.loads(body["task_skeleton_json"])
        stages = [node["key"].removeprefix("node_") for node in skeleton["nodes"]]
        return DecomposeResult(
            stage_count=len(skeleton["nodes"]),
            entry_point=skeleton["entry_point"],
            stages=stages,
            ambiguity_detected=body["ambiguity_detected"],
        )

    def understand(
        self, *, tenant_id: str, workspace_id: str, run_id: str, objective: str
    ) -> str:
        response = self._client.post(
            "/internal/problem-understanding/understand",
            json={
                "tenant_id": tenant_id,
                "workspace_id": workspace_id,
                "run_id": run_id,
                "objective": objective,
            },
        )
        response.raise_for_status()
        return json.dumps(response.json(), separators=(",", ":"))

    def close(self) -> None:
        self._client.close()
