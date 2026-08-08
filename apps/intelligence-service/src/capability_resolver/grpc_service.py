"""gRPC transport for the pure Capability Resolver."""

from __future__ import annotations

import json

import grpc
from pydantic import ValidationError

from alter.capability.v1 import capability_pb2

from .resolver import CapabilityResolutionError, resolve_node_requirements


class CapabilityGrpcService:
    async def ResolveNodeRequirements(
        self,
        request: capability_pb2.ResolveNodeRequirementsRequest,
        context: grpc.aio.ServicerContext[
            capability_pb2.ResolveNodeRequirementsRequest,
            capability_pb2.ResolveNodeRequirementsResponse,
        ],
    ) -> capability_pb2.ResolveNodeRequirementsResponse:
        try:
            config = json.loads(request.node_config_json)
            if not isinstance(config, dict):
                raise ValueError("node_config_json must decode to an object")
            requirements = resolve_node_requirements(
                [
                    {
                        "key": request.node_key,
                        "type": request.node_type,
                        "config": config,
                        # UI metadata is required by the WorkflowDAG envelope but is
                        # deliberately never consulted during capability inference.
                        "metadata": {"ui": {}},
                    }
                ]
            )
        except (CapabilityResolutionError, ValidationError, ValueError) as error:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(error))
            raise AssertionError("context.abort must raise")

        requirement = requirements.root[request.node_key]
        return capability_pb2.ResolveNodeRequirementsResponse(
            node_requirements_json=requirement.model_dump_json(exclude_none=True),
            schema_version="1",
        )
