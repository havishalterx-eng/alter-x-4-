import json

import grpc
import pytest

from alter.capability.v1 import capability_pb2, capability_pb2_grpc
from src.capability_resolver.grpc_service import CapabilityGrpcService


@pytest.mark.asyncio
async def test_resolve_node_requirements_round_trips_through_real_grpc_service() -> None:
    server = grpc.aio.server()
    capability_pb2_grpc.add_CapabilityServiceServicer_to_server(  # type: ignore[no-untyped-call]
        CapabilityGrpcService(), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    try:
        stub = capability_pb2_grpc.CapabilityServiceStub(channel)  # type: ignore[no-untyped-call]
        response = await stub.ResolveNodeRequirements(
            capability_pb2.ResolveNodeRequirementsRequest(
                tenant_id="ten_018f47a5-7b2c-7d10-8f11-123456789abc",
                node_key="summarize",
                node_type="LLMTask",
                node_config_json=json.dumps({"prompt": "Summarize this report"}),
            )
        )
        assert json.loads(response.node_requirements_json) == {
            "capabilities": ["text.generation", "text.summarization"],
            "model_alias": "FAST",
        }
        assert response.schema_version == "1"
    finally:
        await channel.close()
        await server.stop(0)
