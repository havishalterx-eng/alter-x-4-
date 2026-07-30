from __future__ import annotations

from collections.abc import AsyncGenerator

import grpc
import pytest
from fastapi import FastAPI

from alter.adsq.v1 import adsq_pb2, adsq_pb2_grpc
from src.ads_client.client import GrpcAdsClient
from src.ads_client.models import RetrieveRequest
from src.planner.router import get_kernel, planner_lifespan

TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
SCOPE_ID = "wf_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
DOCUMENT_ID = "doc_018f4d6e-2b4a-7a3e-8c1a-1234567890ab"


class _AdsqServer(adsq_pb2_grpc.AdsqServiceServicer):
    def __init__(self, *, unavailable: bool = False) -> None:
        self.unavailable = unavailable
        self.request: adsq_pb2.RetrieveRequest | None = None

    async def Retrieve(
        self,
        request: adsq_pb2.RetrieveRequest,
        context: grpc.aio.ServicerContext[adsq_pb2.RetrieveRequest, adsq_pb2.RetrieveResponse],
    ) -> adsq_pb2.RetrieveResponse:
        self.request = request
        if self.unavailable:
            await context.abort(grpc.StatusCode.RESOURCE_EXHAUSTED, "at capacity")
        return adsq_pb2.RetrieveResponse(
            hits=[
                adsq_pb2.RetrievalHit(
                    document_id=DOCUMENT_ID,
                    chunk_reference="chk_refund",
                    score=0.91,
                    confidence=0.87,
                    provenance_json='{"source":"shopify"}',
                )
            ]
        )


@pytest.fixture
async def adsq_target() -> AsyncGenerator[tuple[_AdsqServer, str], None]:
    implementation = _AdsqServer()
    server = grpc.aio.server()
    adsq_pb2_grpc.add_AdsqServiceServicer_to_server(  # type: ignore[no-untyped-call]
        implementation, server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    try:
        yield implementation, f"127.0.0.1:{port}"
    finally:
        await server.stop(grace=0)


async def test_real_adsq_client_preserves_contract_and_result_fields(
    adsq_target: tuple[_AdsqServer, str],
) -> None:
    server, target = adsq_target
    client = GrpcAdsClient(target)
    try:
        response = await client.retrieve(
            RetrieveRequest(
                tenant_id=TENANT_ID,
                workspace_id=WORKSPACE_ID,
                query="refund policy",
                scope_ids=[SCOPE_ID],
                top_k=3,
            )
        )
    finally:
        await client.close()

    assert server.request is not None
    assert server.request.scope_ids == [SCOPE_ID]
    assert server.request.metadata_filter_json == "{}"
    assert server.request.requester == "intelligence-service"
    assert response.hits[0].document_id == DOCUMENT_ID
    assert response.hits[0].confidence == pytest.approx(0.87)
    assert response.hits[0].provenance_json == '{"source":"shopify"}'


async def test_degraded_adsq_retrieval_returns_empty_context() -> None:
    implementation = _AdsqServer(unavailable=True)
    server = grpc.aio.server()
    adsq_pb2_grpc.add_AdsqServiceServicer_to_server(  # type: ignore[no-untyped-call]
        implementation, server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    client = GrpcAdsClient(f"127.0.0.1:{port}")
    try:
        response = await client.retrieve(
            RetrieveRequest(
                tenant_id=TENANT_ID,
                workspace_id=WORKSPACE_ID,
                query="refund policy",
                scope_ids=[SCOPE_ID],
                top_k=3,
            )
        )
    finally:
        await client.close()
        await server.stop(grace=0)

    assert response.hits == []


async def test_planner_lifespan_wires_real_ads_client() -> None:
    async with planner_lifespan(FastAPI()):
        assert isinstance(get_kernel()._ads, GrpcAdsClient)
