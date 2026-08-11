from __future__ import annotations

import asyncio
import os

import grpc
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from alter.verify.v1 import verify_pb2_grpc
from src.verification.grpc_service import VerifyGrpcService
from src.verification.kernel import VerificationKernel
from src.verification.llm_client import StubReviewerLlmClient
from src.verification.m2m_auth import lazy_auth0_m2m_token_provider_from_environment
from src.verification.model_gateway_client import GrpcModelGatewayClient


async def serve() -> None:
    database_url = _required_environment("ORCHESTRATION_DATABASE_URL")
    model_gateway_target = _required_environment("MODEL_GATEWAY_GRPC_TARGET")
    bind_address = os.environ.get("GRPC_BIND_ADDRESS", "0.0.0.0:50054")

    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    model_gateway = GrpcModelGatewayClient(
        model_gateway_target,
        access_token_provider=lazy_auth0_m2m_token_provider_from_environment(),
    )
    # HARD-7: wires ScoreNodeInline for real. StubReviewerLlmClient is a
    # known, disclosed gap (kernel.py's own doc comment: "wire the stub
    # during development, swap in the real adapter at integration time") --
    # never a real client existed here before this ticket either. Every
    # DETERMINISTIC_NODE_TYPES case (Gate/HumanApproval/Merge/MemoryWrite/
    # PubSub/GroupChat/YAMLImport) never calls this client at all -- only
    # the ADVANCED-reviewer node types (LLMTask/ToolCall/SandboxExec/
    # Synthesis) would get a synthetic, non-real score until a real
    # ADVANCED Model Gateway reviewer client is built (separate, real,
    # disclosed follow-up).
    kernel = VerificationKernel(StubReviewerLlmClient())
    server = grpc.aio.server()
    verify_pb2_grpc.add_VerifyServiceServicer_to_server(  # type: ignore[no-untyped-call]
        VerifyGrpcService(sessions, model_gateway, kernel), server
    )
    server.add_insecure_port(bind_address)
    await server.start()
    try:
        await server.wait_for_termination()
    finally:
        await server.stop(grace=5)
        await model_gateway.close()
        await engine.dispose()


def _required_environment(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


if __name__ == "__main__":
    asyncio.run(serve())
