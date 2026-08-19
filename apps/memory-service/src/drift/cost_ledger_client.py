from __future__ import annotations

from typing import Protocol

import httpx
from pydantic import ValidationError

from .models import ModelOutcomeWindow


class CostLedgerOutcomeUnavailableError(RuntimeError):
    pass


class CostLedgerOutcomeClient(Protocol):
    async def load_outcome_window(
        self,
        *,
        provider: str,
        resource: str | None,
        limit: int,
        authorization: str,
    ) -> ModelOutcomeWindow: ...


class HttpxCostLedgerOutcomeClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._owns_client = client is None

    async def load_outcome_window(
        self,
        *,
        provider: str,
        resource: str | None,
        limit: int,
        authorization: str,
    ) -> ModelOutcomeWindow:
        params = {"provider": provider, "limit": str(limit)}
        if resource is not None:
            params["resource"] = resource
        try:
            response = await self._client.get(
                f"{self._base_url}/internal/model-outcomes",
                params=params,
                headers={"authorization": authorization},
            )
        except httpx.HTTPError as error:
            raise CostLedgerOutcomeUnavailableError(
                "cost ledger outcome request failed"
            ) from error
        if not response.is_success:
            raise CostLedgerOutcomeUnavailableError(
                f"cost ledger outcome request failed with status {response.status_code}"
            )
        try:
            return ModelOutcomeWindow.model_validate(response.json())
        except (ValueError, ValidationError) as error:
            raise CostLedgerOutcomeUnavailableError(
                "cost ledger outcome response failed validation"
            ) from error

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()
