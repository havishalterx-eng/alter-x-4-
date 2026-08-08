from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class ProposeWritebackRequest(_message.Message):
    __slots__ = ("tenant_id", "workspace_id", "run_id", "verified_output_artifact_id", "namespace")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    VERIFIED_OUTPUT_ARTIFACT_ID_FIELD_NUMBER: _ClassVar[int]
    NAMESPACE_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    workspace_id: str
    run_id: str
    verified_output_artifact_id: str
    namespace: str
    def __init__(self, tenant_id: _Optional[str] = ..., workspace_id: _Optional[str] = ..., run_id: _Optional[str] = ..., verified_output_artifact_id: _Optional[str] = ..., namespace: _Optional[str] = ...) -> None: ...

class ProposeWritebackResponse(_message.Message):
    __slots__ = ("memory_id", "candidate_json")
    MEMORY_ID_FIELD_NUMBER: _ClassVar[int]
    CANDIDATE_JSON_FIELD_NUMBER: _ClassVar[int]
    memory_id: str
    candidate_json: str
    def __init__(self, memory_id: _Optional[str] = ..., candidate_json: _Optional[str] = ...) -> None: ...

class PromoteMemoryRequest(_message.Message):
    __slots__ = ("tenant_id", "memory_id", "evaluation_run_id")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ID_FIELD_NUMBER: _ClassVar[int]
    EVALUATION_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    memory_id: str
    evaluation_run_id: str
    def __init__(self, tenant_id: _Optional[str] = ..., memory_id: _Optional[str] = ..., evaluation_run_id: _Optional[str] = ...) -> None: ...

class PromoteMemoryResponse(_message.Message):
    __slots__ = ("promoted", "promoted_at")
    PROMOTED_FIELD_NUMBER: _ClassVar[int]
    PROMOTED_AT_FIELD_NUMBER: _ClassVar[int]
    promoted: bool
    promoted_at: str
    def __init__(self, promoted: _Optional[bool] = ..., promoted_at: _Optional[str] = ...) -> None: ...

class UpdatePolicyRequest(_message.Message):
    __slots__ = ("tenant_id", "policy_id", "current_version", "patch_json")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    POLICY_ID_FIELD_NUMBER: _ClassVar[int]
    CURRENT_VERSION_FIELD_NUMBER: _ClassVar[int]
    PATCH_JSON_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    policy_id: str
    current_version: str
    patch_json: str
    def __init__(self, tenant_id: _Optional[str] = ..., policy_id: _Optional[str] = ..., current_version: _Optional[str] = ..., patch_json: _Optional[str] = ...) -> None: ...

class UpdatePolicyResponse(_message.Message):
    __slots__ = ("policy_id", "new_version")
    POLICY_ID_FIELD_NUMBER: _ClassVar[int]
    NEW_VERSION_FIELD_NUMBER: _ClassVar[int]
    policy_id: str
    new_version: str
    def __init__(self, policy_id: _Optional[str] = ..., new_version: _Optional[str] = ...) -> None: ...
