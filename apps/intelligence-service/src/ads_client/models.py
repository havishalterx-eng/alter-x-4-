"""Pydantic mirrors of packages/contracts/proto/alter/adsq/v1/adsq.proto.

Field names and shapes must stay identical to the proto. Do not add fields
here that are not in the proto, and do not diverge a field's type/nullability
from it -- packages/contracts is the single source of truth for this
contract; this module only gives it a typed Python home for the ADS Client.
"""

import re

from pydantic import BaseModel, Field, field_validator

_UUID_V7_BODY = r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"


def _prefixed_uuid_v7_pattern(prefix: str) -> re.Pattern[str]:
    return re.compile(rf"^{prefix}_{_UUID_V7_BODY}$", re.IGNORECASE)


_TENANT_ID_PATTERN = _prefixed_uuid_v7_pattern("ten")
_WORKSPACE_ID_PATTERN = _prefixed_uuid_v7_pattern("ws")
_DOCUMENT_ID_PATTERN = _prefixed_uuid_v7_pattern("doc")
# scope_ids carry Alter-prefixed UUIDv7 values from any domain (workflow,
# project, agent, ...), so only the generic "<lowercase-prefix>_<uuidv7>"
# shape is enforced here, not one fixed prefix.
_GENERIC_PREFIXED_ID_PATTERN = re.compile(
    rf"^[a-z]{{2,8}}_{_UUID_V7_BODY}$", re.IGNORECASE
)


def _validate(pattern: re.Pattern[str], value: str, field_name: str) -> str:
    if not pattern.match(value):
        raise ValueError(f"{field_name} must match {pattern.pattern}")
    return value


class RetrievalHit(BaseModel):
    model_config = {"frozen": True}

    document_id: str
    chunk_reference: str
    score: float
    confidence: float
    provenance_json: str

    @field_validator("document_id")
    @classmethod
    def _validate_document_id(cls, value: str) -> str:
        return _validate(_DOCUMENT_ID_PATTERN, value, "document_id")


class RetrieveRequest(BaseModel):
    model_config = {"frozen": True}

    tenant_id: str
    workspace_id: str
    query: str
    scope_ids: list[str] = Field(default_factory=list)
    top_k: int = Field(ge=0)

    @field_validator("tenant_id")
    @classmethod
    def _validate_tenant_id(cls, value: str) -> str:
        return _validate(_TENANT_ID_PATTERN, value, "tenant_id")

    @field_validator("workspace_id")
    @classmethod
    def _validate_workspace_id(cls, value: str) -> str:
        return _validate(_WORKSPACE_ID_PATTERN, value, "workspace_id")

    @field_validator("scope_ids")
    @classmethod
    def _validate_scope_ids(cls, value: list[str]) -> list[str]:
        for scope_id in value:
            _validate(_GENERIC_PREFIXED_ID_PATTERN, scope_id, "scope_ids[]")
        return value


class RetrieveResponse(BaseModel):
    model_config = {"frozen": True}

    hits: list[RetrievalHit] = Field(default_factory=list)


class RerankRequest(BaseModel):
    model_config = {"frozen": True}

    tenant_id: str
    workspace_id: str
    query: str
    candidates: list[RetrievalHit] = Field(default_factory=list)

    @field_validator("tenant_id")
    @classmethod
    def _validate_tenant_id(cls, value: str) -> str:
        return _validate(_TENANT_ID_PATTERN, value, "tenant_id")

    @field_validator("workspace_id")
    @classmethod
    def _validate_workspace_id(cls, value: str) -> str:
        return _validate(_WORKSPACE_ID_PATTERN, value, "workspace_id")


class RerankResponse(BaseModel):
    model_config = {"frozen": True}

    hits: list[RetrievalHit] = Field(default_factory=list)


class GetProvenanceRequest(BaseModel):
    model_config = {"frozen": True}

    tenant_id: str
    document_id: str

    @field_validator("tenant_id")
    @classmethod
    def _validate_tenant_id(cls, value: str) -> str:
        return _validate(_TENANT_ID_PATTERN, value, "tenant_id")

    @field_validator("document_id")
    @classmethod
    def _validate_document_id(cls, value: str) -> str:
        return _validate(_DOCUMENT_ID_PATTERN, value, "document_id")


class GetProvenanceResponse(BaseModel):
    model_config = {"frozen": True}

    provenance_json: str
    confidence: float
