from __future__ import annotations

import asyncio

import httpx
import pytest

from src.memory_learning.orchestration_client import (
    HttpxOrchestrationRunClient,
    OrchestrationUnavailableError,
    RunNotCompletedError,
    RunNotFoundError,
)

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ad"


def valid_summary() -> dict[str, object]:
    return {
        "tenant_id": TENANT_ID,
        "run_id": RUN_ID,
        "workspace_id": "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ac",
        "verdict": "completed_verified",
        "gates_passed": 1,
        "gates_failed": 0,
        "recovery_count": 0,
        "nodes": [],
        "recovery_actions": [],
    }


def test_calls_internal_summary_endpoint_with_forwarded_m2m_bearer() -> None:
    seen: httpx.Request | None = None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal seen
        seen = request
        return httpx.Response(200, json=valid_summary())

    transport = httpx.MockTransport(handler)
    http = httpx.AsyncClient(transport=transport)
    client = HttpxOrchestrationRunClient("https://orchestration.internal", 2, http)
    result = asyncio.run(
        client.load_summary(
            tenant_id=TENANT_ID,
            run_id=RUN_ID,
            authorization="Bearer tenant-token",
        )
    )

    assert result.verdict == "completed_verified"
    assert seen is not None
    assert str(seen.url) == (
        f"https://orchestration.internal/internal/runs/{RUN_ID}/outcome-summary"
    )
    assert seen.headers["authorization"] == "Bearer tenant-token"
    asyncio.run(http.aclose())


@pytest.mark.parametrize(
    ("status", "error_type"),
    [(404, RunNotFoundError), (409, RunNotCompletedError)],
)
def test_maps_typed_run_errors(status: int, error_type: type[Exception]) -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(status, request=request))
    http = httpx.AsyncClient(transport=transport)
    client = HttpxOrchestrationRunClient("https://orchestration.internal", 2, http)
    with pytest.raises(error_type):
        asyncio.run(
            client.load_summary(
                tenant_id=TENANT_ID,
                run_id=RUN_ID,
                authorization="Bearer token",
            )
        )
    asyncio.run(http.aclose())


def test_rejects_malformed_success_response() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"run_id": RUN_ID}, request=request)
    )
    http = httpx.AsyncClient(transport=transport)
    client = HttpxOrchestrationRunClient("https://orchestration.internal", 2, http)
    with pytest.raises(OrchestrationUnavailableError, match="failed validation"):
        asyncio.run(
            client.load_summary(
                tenant_id=TENANT_ID,
                run_id=RUN_ID,
                authorization="Bearer token",
            )
        )
    asyncio.run(http.aclose())
