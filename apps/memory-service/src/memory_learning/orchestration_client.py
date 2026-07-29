from __future__ import annotations

from typing import Protocol

import httpx
from pydantic import ValidationError

from .models import RunLearningSummary


class RunNotFoundError(RuntimeError):
    pass


class RunNotCompletedError(RuntimeError):
    pass


class OrchestrationUnavailableError(RuntimeError):
    pass


class OrchestrationRunClient(Protocol):
    async def load_summary(
        self,
        *,
        tenant_id: str,
        run_id: str,
        authorization: str,
    ) -> RunLearningSummary: ...


class HttpxOrchestrationRunClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None

    async def load_summary(
        self,
        *,
        tenant_id: str,
        run_id: str,
        authorization: str,
    ) -> RunLearningSummary:
        del tenant_id  # Tenant comes from validated service token at orchestration ingress.
        try:
            response = await self._client.get(
                f"{self._base_url}/internal/runs/{run_id}/outcome-summary",
                headers={"authorization": authorization},
            )
        except httpx.HTTPError as error:
            raise OrchestrationUnavailableError("orchestration summary request failed") from error
        if response.status_code == 404:
            raise RunNotFoundError(f"Run {run_id} was not found")
        if response.status_code == 409:
            raise RunNotCompletedError(f"Run {run_id} has no completed outcome")
        if not response.is_success:
            raise OrchestrationUnavailableError(
                f"orchestration summary request failed with status {response.status_code}"
            )
        try:
            return RunLearningSummary.model_validate(response.json())
        except (ValueError, ValidationError) as error:
            raise OrchestrationUnavailableError(
                "orchestration summary response failed validation"
            ) from error

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()
