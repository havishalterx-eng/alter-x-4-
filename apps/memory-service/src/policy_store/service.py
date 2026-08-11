from __future__ import annotations

import asyncio
import json
import math

from pydantic import ValidationError

from src.memory_learning.ids import raw_uuid7
from src.service_auth import ServiceAuthError, verify_global_write_token, verify_service_token

from .models import (
    CreateDraftPolicyResponse,
    GetActivePolicyRequest,
    GetActivePolicyResponse,
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
        global_write_token: str | None = None,
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
            global_write_authorized=verify_global_write_token(global_write_token),
        )
        return UpdatePolicyResponse(
            policy_id=result.policy_id,
            new_version=str(result.new_version),
        )

    async def create_draft_routing_policy(
        self, *, tenant_id: str, body: dict[str, object], authorization: str
    ) -> CreateDraftPolicyResponse:
        self._validate_authorization(authorization)
        tenant_uuid = self._raw_id(tenant_id, "ten")
        return await asyncio.to_thread(
            self._repository.create_draft_policy_from_active,
            tenant_uuid=tenant_uuid,
            kind="routing_weights",
            body=body,
        )

    async def apply_drift_decay(
        self,
        *,
        tenant_id: str,
        score: float,
        authorization: str,
    ) -> bool:
        active = await self.get_active_policy(
            GetActivePolicyRequest(tenant_id=tenant_id, kind="routing_weights"),
            authorization,
        )
        if (
            not active.found
            or active.policy_id is None
            or active.version is None
            or active.body_json is None
        ):
            return False
        body = json.loads(active.body_json)
        weight = body.get("similarity_weight") if isinstance(body, dict) else None
        if isinstance(weight, bool) or not isinstance(weight, (int, float)):
            return False
        current = float(weight)
        if not math.isfinite(current) or not 0 <= current <= 1:
            return False
        decayed_body = {
            **body,
            "similarity_weight": max(0.0, min(1.0, current * (1.0 - score))),
        }
        draft = await self.create_draft_routing_policy(
            tenant_id=tenant_id,
            body=decayed_body,
            authorization=authorization,
        )
        canary = await self.update_policy(
            UpdatePolicyRequest(
                tenant_id=tenant_id,
                policy_id=draft.policy_id,
                current_version=str(draft.version),
                patch_json='{"status":"canary","reason":"drift decay"}',
            ),
            authorization,
        )
        await self.update_policy(
            UpdatePolicyRequest(
                tenant_id=tenant_id,
                policy_id=active.policy_id,
                current_version=str(active.version),
                patch_json='{"status":"rolled_back","reason":"superseded by drift decay"}',
            ),
            authorization,
        )
        await self.update_policy(
            UpdatePolicyRequest(
                tenant_id=tenant_id,
                policy_id=draft.policy_id,
                current_version=canary.new_version,
                patch_json='{"status":"active","reason":"drift decay promoted"}',
            ),
            authorization,
        )
        return True

    async def promote_memory(
        self,
        request: PromoteMemoryRequest,
        authorization: str,
        global_write_token: str | None = None,
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
            global_write_authorized=verify_global_write_token(global_write_token),
        )
        return PromoteMemoryResponse(promoted=True, promoted_at=result.promoted_at)

    async def get_active_policy(
        self,
        request: GetActivePolicyRequest,
        authorization: str,
    ) -> GetActivePolicyResponse:
        self._validate_authorization(authorization)
        tenant_uuid = self._raw_id(request.tenant_id, "ten")
        policy = await asyncio.to_thread(
            self._repository.get_active_policy,
            tenant_uuid=tenant_uuid,
            kind=request.kind,
        )
        if policy is None:
            return GetActivePolicyResponse(found=False)
        return GetActivePolicyResponse(
            found=True,
            policy_id=policy.id,
            version=policy.version,
            body_json=json.dumps(policy.body, sort_keys=True, separators=(",", ":")),
        )

    @staticmethod
    def _raw_id(value: str, prefix: str) -> str:
        try:
            return raw_uuid7(value, prefix)
        except ValueError as error:
            raise PolicyStoreValidationError(str(error)) from error

    @staticmethod
    def _validate_authorization(authorization: str) -> None:
        """Verify the caller actually holds the internal service credential.

        This previously checked only that the string began with "Bearer " and
        had a non-space character after it, so `Bearer x` authenticated a caller
        to read and write any tenant's policy, and to transition the global
        recovery policy that governs every tenant.
        """
        try:
            verify_service_token(authorization)
        except ServiceAuthError as error:
            raise PolicyStoreValidationError(str(error)) from error
