"""Lifecycle helpers for CapabilityService's gRPC server."""

from __future__ import annotations

import grpc

from alter.capability.v1 import capability_pb2_grpc

from .grpc_service import CapabilityGrpcService


async def start_capability_server(bind_address: str) -> grpc.aio.Server:
    server = grpc.aio.server()
    capability_pb2_grpc.add_CapabilityServiceServicer_to_server(  # type: ignore[no-untyped-call]
        CapabilityGrpcService(), server
    )
    if server.add_insecure_port(bind_address) == 0:
        raise RuntimeError(f"Could not bind CapabilityService to {bind_address}")
    await server.start()
    return server
