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


@pytest.mark.asyncio
async def test_resolver_grpc_rejects_invalid_input_and_keeps_ids_out_of_inference() -> None:
    server = grpc.aio.server()
    capability_pb2_grpc.add_CapabilityServiceServicer_to_server(  # type: ignore[no-untyped-call]
        CapabilityGrpcService(), server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    try:
        stub = capability_pb2_grpc.CapabilityServiceStub(channel)  # type: ignore[no-untyped-call]
        request = {
            "node_key": "tool",
            "node_type": "ToolCall",
            "node_config_json": json.dumps(
                {
                    "tool_name": "search.web",
                    "tool_version": "v1",
                    "permissions": ["web:read"],
                }
            ),
        }
        first = await stub.ResolveNodeRequirements(
            capability_pb2.ResolveNodeRequirementsRequest(
                tenant_id="ten_018f47a5-7b2c-7d10-8f11-123456789abc",
                run_id="run_018f47a5-7b2c-7d10-8f11-123456789abc",
                **request,
            )
        )
        second = await stub.ResolveNodeRequirements(
            capability_pb2.ResolveNodeRequirementsRequest(
                tenant_id="ten_018f47a5-7b2c-7d10-8f11-123456789abd",
                run_id="run_018f47a5-7b2c-7d10-8f11-123456789abd",
                **request,
            )
        )
        assert first.node_requirements_json == second.node_requirements_json
        assert json.loads(first.node_requirements_json) == {
            "capabilities": [],
            "tools": [
                {
                    "name": "search.web",
                    "version": "v1",
                    "permissions": ["web:read"],
                }
            ],
        }

        for invalid in (
            {"node_config_json": "{"},
            {"node_type": "Unknown"},
            {"node_key": "not a key"},
            {"node_config_json": json.dumps({"tool_name": "search.web", "tools": []})},
        ):
            with pytest.raises(grpc.aio.AioRpcError) as error:
                await stub.ResolveNodeRequirements(
                    capability_pb2.ResolveNodeRequirementsRequest(**{**request, **invalid})
                )
            assert error.value.code() is grpc.StatusCode.INVALID_ARGUMENT
    finally:
        await channel.close()
        await server.stop(0)
