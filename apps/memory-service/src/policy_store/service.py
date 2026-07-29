from __future__ import annotations

import asyncio
import json

from pydantic import ValidationError

from src.memory_learning.ids import raw_uuid7

from .models import (
    PolicyPatch,
    PromoteMemoryRequest,
    PromoteMemoryResponse,
    UpdatePolicyRequest,
    UpdatePolicyResponse,
)
from .repository import SqlAlchemyPolicyStoreRepository


class PolicyStoreValidationError(ValueError):
    pass


class PolicyStoreService:
    def __init__(self, repository: SqlAlchemyPolicyStoreRepository) -> None:
        self._repository = repository

    async def update_policy(
        self,
        request: UpdatePolicyRequest,
        authorization: str,
    ) -> UpdatePolicyResponse:
        self._validate_authorization(authorization)
        tenant_uuid = self._raw_id(request.tenant_id, "ten")
        self._raw_id(request.policy_id, "pol")
        try:
            current_version = int(request.current_version)
        except ValueError as error:
            raise PolicyStoreValidationError(
                "current_version must be a positive integer"
            ) from error
        if current_version <= 0 or str(current_version) != request.current_version:
            raise PolicyStoreValidationError("current_version must be a positive integer")
        try:
            patch = PolicyPatch.model_validate_json(request.patch_json)
        except (ValueError, ValidationError, json.JSONDecodeError) as error:
            raise PolicyStoreValidationError("patch_json failed validation") from error

        result = await asyncio.to_thread(
            self._repository.update_policy,
            tenant_uuid=tenant_uuid,
            policy_id=request.policy_id,
            current_version=current_version,
            patch=patch,
            actor="memory-service",
        )
        return UpdatePolicyResponse(
            policy_id=result.policy_id,
            new_version=str(result.new_version),
        )

    async def promote_memory(
        self,
        request: PromoteMemoryRequest,
        authorization: str,
    ) -> PromoteMemoryResponse:
        self._validate_authorization(authorization)
        tenant_uuid = self._raw_id(request.tenant_id, "ten")
        self._raw_id(request.memory_id, "mem")
        self._raw_id(request.evaluation_run_id, "evr")
        result = await asyncio.to_thread(
            self._repository.promote_memory,
            tenant_uuid=tenant_uuid,
            memory_id=request.memory_id,
            evaluation_run_id=request.evaluation_run_id,
        )
        return PromoteMemoryResponse(promoted=True, promoted_at=result.promoted_at)

    @staticmethod
    def _raw_id(value: str, prefix: str) -> str:
        try:
            return raw_uuid7(value, prefix)
        except ValueError as error:
            raise PolicyStoreValidationError(str(error)) from error

    @staticmethod
    def _validate_authorization(authorization: str) -> None:
        if not authorization.startswith("Bearer ") or not authorization.removeprefix(
            "Bearer "
        ).strip():
            raise PolicyStoreValidationError("valid bearer authorization is required")
