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
