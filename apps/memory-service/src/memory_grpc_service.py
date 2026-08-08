from __future__ import annotations

from collections.abc import Awaitable, Callable

import grpc
from pydantic import ValidationError

from alter.memory.v1 import memory_pb2

from .memory_learning.extraction import MemoryLearningKernel, MemoryLearningValidationError
from .memory_learning.models import ProposeWritebackRequest
from .memory_learning.orchestration_client import (
    OrchestrationUnavailableError,
    RunNotCompletedError,
    RunNotFoundError,
)
from .policy_store.models import PromoteMemoryRequest, UpdatePolicyRequest
from .policy_store.repository import (
    MemoryNotFoundError,
    MemoryPromotionConflictError,
    PolicyNotFoundError,
    PolicyTransitionError,
    PolicyVersionConflictError,
)
from .policy_store.service import PolicyStoreService, PolicyStoreValidationError


class MemoryGrpcService:
    def __init__(self, learning: MemoryLearningKernel, policies: PolicyStoreService) -> None:
        self._learning = learning
        self._policies = policies

    async def ProposeWriteback(
        self,
        request: memory_pb2.ProposeWritebackRequest,
        context: grpc.aio.ServicerContext[object, object],
    ) -> memory_pb2.ProposeWritebackResponse:
        try:
            result = await self._learning.propose_writeback(
                ProposeWritebackRequest(
                    tenant_id=request.tenant_id,
                    workspace_id=request.workspace_id,
                    run_id=request.run_id,
                    verified_output_artifact_id=request.verified_output_artifact_id,
                    namespace=request.namespace,
                ),
                _authorization(context),
            )
        except ValidationError as error:
            await _abort(context.abort, grpc.StatusCode.INVALID_ARGUMENT, str(error))
        except MemoryLearningValidationError as error:
            await _abort(context.abort, grpc.StatusCode.INVALID_ARGUMENT, str(error))
        except RunNotFoundError as error:
            await _abort(context.abort, grpc.StatusCode.NOT_FOUND, str(error))
        except RunNotCompletedError as error:
            await _abort(context.abort, grpc.StatusCode.FAILED_PRECONDITION, str(error))
        except OrchestrationUnavailableError as error:
            await _abort(context.abort, grpc.StatusCode.UNAVAILABLE, str(error))
        return memory_pb2.ProposeWritebackResponse(
            memory_id=result.memory_id, candidate_json=result.candidate_json
        )

    async def PromoteMemory(
        self,
        request: memory_pb2.PromoteMemoryRequest,
        context: grpc.aio.ServicerContext[object, object],
    ) -> memory_pb2.PromoteMemoryResponse:
        try:
            result = await self._policies.promote_memory(
                PromoteMemoryRequest(
                    tenant_id=request.tenant_id,
                    memory_id=request.memory_id,
                    evaluation_run_id=request.evaluation_run_id,
                ),
                _authorization(context),
            )
        except (ValidationError, PolicyStoreValidationError) as error:
            await _abort(context.abort, grpc.StatusCode.INVALID_ARGUMENT, str(error))
        except MemoryNotFoundError as error:
            await _abort(context.abort, grpc.StatusCode.NOT_FOUND, str(error))
        except MemoryPromotionConflictError as error:
            await _abort(context.abort, grpc.StatusCode.FAILED_PRECONDITION, str(error))
        return memory_pb2.PromoteMemoryResponse(
            promoted=result.promoted, promoted_at=result.promoted_at.isoformat()
        )

    async def UpdatePolicy(
        self,
        request: memory_pb2.UpdatePolicyRequest,
        context: grpc.aio.ServicerContext[object, object],
    ) -> memory_pb2.UpdatePolicyResponse:
        try:
            result = await self._policies.update_policy(
                UpdatePolicyRequest(
                    tenant_id=request.tenant_id,
                    policy_id=request.policy_id,
                    current_version=request.current_version,
                    patch_json=request.patch_json,
                ),
                _authorization(context),
            )
        except (
            ValidationError,
            PolicyStoreValidationError,
            PolicyTransitionError,
        ) as error:
            await _abort(context.abort, grpc.StatusCode.INVALID_ARGUMENT, str(error))
        except PolicyNotFoundError as error:
            await _abort(context.abort, grpc.StatusCode.NOT_FOUND, str(error))
        except PolicyVersionConflictError as error:
            await _abort(context.abort, grpc.StatusCode.FAILED_PRECONDITION, str(error))
        return memory_pb2.UpdatePolicyResponse(
            policy_id=result.policy_id, new_version=result.new_version
        )


def _authorization(context: grpc.aio.ServicerContext[object, object]) -> str:
    return next(
        (
            value
            for key, value in context.invocation_metadata()
            if key.lower() == "authorization"
        ),
        "",
    )


async def _abort(
    abort: Callable[[grpc.StatusCode, str], Awaitable[None]],
    code: grpc.StatusCode,
    details: str,
) -> None:
    await abort(code, details)
    raise AssertionError("context.abort must raise")
