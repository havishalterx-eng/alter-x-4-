"""Real HTTP client to intelligence-service's Architecture Synthesizer.

Calls the same internal routes the platform pipeline reaches through
prepare-compiler-input: /internal/architecture-synthesis/synthesize, and the
Capability Registry to register the architecture golden set's fixture records.
"""

from __future__ import annotations

from typing import Any

import httpx

DEFAULT_TIMEOUT_SECONDS = 30.0
_ALREADY_REGISTERED = "an active version already exists"


class ArchitectureClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        *,
        service_token: str = "",
    ) -> None:
        headers = {"Authorization": f"Bearer {service_token}"} if service_token else None
        self._client = httpx.Client(base_url=base_url, timeout=timeout_seconds, headers=headers)

    def ensure_registered(self, tenant_id: str, records: tuple[dict[str, Any], ...]) -> None:
        """Register fixture records, treating an existing active version as done.

        The registry refuses a second active version of one capability_id, so
        a repeat eval run finds the records from the first and moves on.
        """
        for record in records:
            response = self._client.post(
                f"/internal/capability-registry/{tenant_id}/records", json=record
            )
            if response.status_code == 422 and _ALREADY_REGISTERED in response.text:
                continue
            response.raise_for_status()

    def synthesize(
        self,
        *,
        tenant_id: str,
        workspace_id: str,
        task_skeleton: dict[str, Any],
        node_requirements: dict[str, Any],
        constraints: dict[str, Any],
    ) -> dict[str, Any]:
        response = self._client.post(
            "/internal/architecture-synthesis/synthesize",
            json={
                "tenant_id": tenant_id,
                "workspace_id": workspace_id,
                "task_skeleton": task_skeleton,
                "node_requirements": node_requirements,
                "constraints": constraints,
            },
        )
        response.raise_for_status()
        body: dict[str, Any] = response.json()
        return body

    def close(self) -> None:
        self._client.close()
