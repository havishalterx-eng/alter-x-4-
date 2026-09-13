import json

import httpx
import pytest

from src.selection_binding.policy_client import HttpRoutingPolicyClient

TENANT = "ten_018f47a5-7b2c-7d10-8f11-123456789abc"


def client_for(payload: object) -> HttpRoutingPolicyClient:
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    return HttpRoutingPolicyClient(
        "http://policy.test",
        "Bearer test",
        httpx.AsyncClient(
            base_url="http://policy.test",
            transport=transport,
            headers={"Authorization": "Bearer test"},
        ),
    )


@pytest.mark.asyncio
async def test_reads_active_routing_weights_from_policy_store() -> None:
    client = client_for(
        {
            "found": True,
            "body_json": json.dumps(
                {"similarity_weight": 0.25, "efficiency_weight": 0.6}
            ),
        }
    )
    try:
        weights = await client.routing_weights(TENANT)
    finally:
        await client.close()

    assert weights is not None
    assert weights.similarity_weight == 0.25
    assert weights.efficiency_weight == 0.6


@pytest.mark.asyncio
async def test_a_body_without_efficiency_weight_leaves_it_unset() -> None:
    # Every routing_weights body written before #159 looks like this. It has
    # to read as "this policy does not set that weight" rather than as zero,
    # so the engine falls back to its own default instead of turning cost
    # blindness back on.
    client = client_for(
        {"found": True, "body_json": json.dumps({"similarity_weight": 0.25})}
    )
    try:
        weights = await client.routing_weights(TENANT)
    finally:
        await client.close()

    assert weights is not None
    assert weights.similarity_weight == 0.25
    assert weights.efficiency_weight is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "value",
    [True, "0.5", None, 1.5, -0.1],
    ids=["bool", "string", "null", "above-one", "negative"],
)
async def test_a_weight_outside_the_unit_interval_is_not_a_weight(
    value: object,
) -> None:
    # `True` is the one worth spelling out: bool is an int in Python, so
    # without the explicit check it would read as a weight of 1.0.
    client = client_for(
        {"found": True, "body_json": json.dumps({"efficiency_weight": value})}
    )
    try:
        weights = await client.routing_weights(TENANT)
    finally:
        await client.close()

    assert weights is not None
    assert weights.efficiency_weight is None


@pytest.mark.asyncio
async def test_no_active_policy_reads_as_no_weights() -> None:
    client = client_for({"found": False})
    try:
        assert await client.routing_weights(TENANT) is None
    finally:
        await client.close()
