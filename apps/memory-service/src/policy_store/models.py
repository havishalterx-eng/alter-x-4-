from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

PolicyStatus = Literal["draft", "canary", "active", "rolled_back", "retired"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class UpdatePolicyRequest(StrictModel):
    tenant_id: str
    policy_id: str
    current_version: str
    patch_json: str


class UpdatePolicyResponse(StrictModel):
    policy_id: str
    new_version: str


class CreateDraftPolicyResponse(StrictModel):
    policy_id: str
    version: int


class PolicyPatch(StrictModel):
    status: PolicyStatus | None = None
    body: dict[str, object] | None = None
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _has_change(self) -> PolicyPatch:
        if self.status is None and self.body is None:
            raise ValueError("patch_json must change status or body")
        if self.reason is not None and not self.reason.strip():
            raise ValueError("reason must not be blank")
        return self


class PromoteMemoryRequest(StrictModel):
    tenant_id: str
    memory_id: str
    evaluation_run_id: str


class PromoteMemoryResponse(StrictModel):
    promoted: bool
    promoted_at: datetime


class StoredPolicyUpdate(StrictModel):
    policy_id: str
    new_version: int
    status: PolicyStatus


class StoredMemoryPromotion(StrictModel):
    memory_id: str
    promoted_at: datetime


PolicyKind = Literal[
    "routing_weights",
    "quality_thresholds",
    "recovery_preferences",
    "provider_policy",
    "model_alias_map",
    "trigger_limits",
]


class GetActivePolicyRequest(StrictModel):
    tenant_id: str
    kind: PolicyKind


class GetActivePolicyResponse(StrictModel):
    """`found=False` (not a 404) is the real, expected response when no
    policy has been promoted for this kind yet -- callers (e.g. HEAL-6's
    recovery-strategy-table) fall back to their own deterministic default
    in that case, so this is not an error."""

    found: bool
    policy_id: str | None = None
    version: int | None = None
    body_json: str | None = None
