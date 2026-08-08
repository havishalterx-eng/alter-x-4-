import json

import httpx
import pytest

from src.selection_binding.policy_client import HttpRoutingPolicyClient


@pytest.mark.asyncio
async def test_reads_active_routing_weight_from_policy_store() -> None:
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={"found": True, "body_json": json.dumps({"similarity_weight": 0.25})},
        )
    )
    client = HttpRoutingPolicyClient(
        "http://policy.test",
        "Bearer test",
        httpx.AsyncClient(
            base_url="http://policy.test",
            transport=transport,
            headers={"Authorization": "Bearer test"},
        ),
    )
    try:
        assert await client.similarity_weight("ten_018f47a5-7b2c-7d10-8f11-123456789abc") == 0.25
    finally:
        await client.close()
