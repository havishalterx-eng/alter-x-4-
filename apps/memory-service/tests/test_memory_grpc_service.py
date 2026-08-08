from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime

import grpc
import pytest

from alter.memory.v1 import memory_pb2, memory_pb2_grpc
from src.memory_grpc_service import MemoryGrpcService
from src.memory_learning.models import ProposeWritebackResponse
from src.policy_store.models import PromoteMemoryResponse, UpdatePolicyResponse

TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ac"
RUN = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ad"
ARTIFACT = "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ae"
MEMORY = "mem_018f4d6e-2b4a-7a3e-8c1a-1234567890af"
POLICY = "pol_018f4d6e-2b4a-7a3e-8c1a-1234567890aa"
EVALUATION = "evr_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"


class Learning:
    def __init__(self) -> None:
        self.authorization = ""

    async def propose_writeback(
        self, request: object, authorization: str
    ) -> ProposeWritebackResponse:
        del request
        self.authorization = authorization
        if not authorization:
            from src.memory_learning.extraction import MemoryLearningValidationError

            raise MemoryLearningValidationError("valid bearer authorization is required")
        return ProposeWritebackResponse(memory_id=MEMORY, candidate_json='{"source":"run"}')


class Policies:
    async def promote_memory(
        self,
        request: object,
        authorization: str,
    ) -> PromoteMemoryResponse:
        del request, authorization
        return PromoteMemoryResponse(promoted=True, promoted_at=datetime(2026, 8, 8, tzinfo=UTC))

    async def update_policy(
        self,
        request: object,
        authorization: str,
    ) -> UpdatePolicyResponse:
        del request, authorization
        return UpdatePolicyResponse(policy_id=POLICY, new_version="2")


@pytest.fixture()
async def grpc_stub() -> AsyncGenerator[tuple[memory_pb2_grpc.MemoryServiceStub, Learning], None]:
    learning = Learning()
    server = grpc.aio.server()
    memory_pb2_grpc.add_MemoryServiceServicer_to_server(  # type: ignore[no-untyped-call]
        MemoryGrpcService(learning, Policies()),  # type: ignore[arg-type]
        server,
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    try:
        yield memory_pb2_grpc.MemoryServiceStub(channel), learning  # type: ignore[no-untyped-call]
    finally:
        await channel.close()
        await server.stop(grace=0)


async def test_propose_writeback_delegates_with_grpc_bearer_auth(
    grpc_stub: tuple[memory_pb2_grpc.MemoryServiceStub, Learning],
) -> None:
    stub, learning = grpc_stub
    response = await stub.ProposeWriteback(
        memory_pb2.ProposeWritebackRequest(
            tenant_id=TENANT,
            workspace_id=WORKSPACE,
            run_id=RUN,
            verified_output_artifact_id=ARTIFACT,
            namespace="project-memory",
        ),
        metadata=(("authorization", "Bearer service-token"),),
    )

    assert response.memory_id == MEMORY
    assert response.candidate_json == '{"source":"run"}'
    assert learning.authorization == "Bearer service-token"


async def test_policy_rpcs_delegate_to_the_existing_policy_service(
    grpc_stub: tuple[memory_pb2_grpc.MemoryServiceStub, Learning],
) -> None:
    stub, _ = grpc_stub
    metadata = (("authorization", "Bearer service-token"),)

    promoted = await stub.PromoteMemory(
        memory_pb2.PromoteMemoryRequest(
            tenant_id=TENANT, memory_id=MEMORY, evaluation_run_id=EVALUATION
        ),
        metadata=metadata,
    )
    updated = await stub.UpdatePolicy(
        memory_pb2.UpdatePolicyRequest(
            tenant_id=TENANT,
            policy_id=POLICY,
            current_version="1",
            patch_json='{"status":"active"}',
        ),
        metadata=metadata,
    )

    assert promoted.promoted is True
    assert promoted.promoted_at == "2026-08-08T00:00:00+00:00"
    assert updated.policy_id == POLICY
    assert updated.new_version == "2"


async def test_propose_writeback_rejects_missing_bearer_auth(
    grpc_stub: tuple[memory_pb2_grpc.MemoryServiceStub, Learning],
) -> None:
    stub, _ = grpc_stub
    with pytest.raises(grpc.aio.AioRpcError) as caught:
        await stub.ProposeWriteback(
            memory_pb2.ProposeWritebackRequest(
                tenant_id=TENANT,
                workspace_id=WORKSPACE,
                run_id=RUN,
                verified_output_artifact_id=ARTIFACT,
                namespace="project-memory",
            )
        )
    assert caught.value.code() == grpc.StatusCode.INVALID_ARGUMENT
