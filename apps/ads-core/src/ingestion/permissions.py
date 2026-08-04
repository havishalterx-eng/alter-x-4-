from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

PermissionSubject = Annotated[str, Field(min_length=1)]


class _StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class DocumentPermissions(_StrictFrozenModel):
    visibility: Literal["tenant"]
    shared_with: tuple[PermissionSubject, ...]


class DocumentPermissionsPatch(_StrictFrozenModel):
    visibility: Literal["tenant"] | None = None
    shared_with: tuple[PermissionSubject, ...] | None = None

    @model_validator(mode="after")
    def require_non_null_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("At least one permission field must be provided")
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


def default_permissions() -> dict[str, object]:
    """Starting-point permissions for a newly-ingested document.

    No ACL/sharing system exists anywhere in this repo yet -- this is a real,
    honest default (tenant-wide read, no explicit external shares), not a
    full permissions engine. A future ticket that adds real per-document
    sharing controls should replace this, not KNOW-4.
    """
    return {"visibility": "tenant", "shared_with": []}
