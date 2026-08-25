"""Lifecycle helpers for CapabilityService's gRPC server."""

from __future__ import annotations

import grpc

from alter.capability.v1 import capability_pb2_grpc

from ..service_auth import ServiceAuthInterceptor
from .grpc_service import CapabilityGrpcService


async def start_capability_server(bind_address: str) -> grpc.aio.Server:
    # Every RPC requires the internal service credential -- interceptor, not
    # per-RPC checks, so a new RPC cannot forget it.
    server = grpc.aio.server(interceptors=[ServiceAuthInterceptor()])
    capability_pb2_grpc.add_CapabilityServiceServicer_to_server(  # type: ignore[no-untyped-call]
        CapabilityGrpcService(), server
    )
    if server.add_insecure_port(bind_address) == 0:
        raise RuntimeError(f"Could not bind CapabilityService to {bind_address}")
    await server.start()
    return server
