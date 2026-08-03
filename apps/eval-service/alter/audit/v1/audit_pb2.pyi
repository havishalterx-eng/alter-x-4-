from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class RecordEventRequest(_message.Message):
    __slots__ = ("tenant_id", "actor_type", "actor_ref", "action", "target_type", "target_ref", "result", "reason_code", "context_json", "occurred_at")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_TYPE_FIELD_NUMBER: _ClassVar[int]
    ACTOR_REF_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    TARGET_TYPE_FIELD_NUMBER: _ClassVar[int]
    TARGET_REF_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    REASON_CODE_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_JSON_FIELD_NUMBER: _ClassVar[int]
    OCCURRED_AT_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    actor_type: str
    actor_ref: str
    action: str
    target_type: str
    target_ref: str
    result: str
    reason_code: str
    context_json: str
    occurred_at: str
    def __init__(self, tenant_id: _Optional[str] = ..., actor_type: _Optional[str] = ..., actor_ref: _Optional[str] = ..., action: _Optional[str] = ..., target_type: _Optional[str] = ..., target_ref: _Optional[str] = ..., result: _Optional[str] = ..., reason_code: _Optional[str] = ..., context_json: _Optional[str] = ..., occurred_at: _Optional[str] = ...) -> None: ...

class RecordEventResponse(_message.Message):
    __slots__ = ("id", "entry_hash")
    ID_FIELD_NUMBER: _ClassVar[int]
    ENTRY_HASH_FIELD_NUMBER: _ClassVar[int]
    id: str
    entry_hash: str
    def __init__(self, id: _Optional[str] = ..., entry_hash: _Optional[str] = ...) -> None: ...

class GetEventRequest(_message.Message):
    __slots__ = ("tenant_id", "event_id")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    event_id: str
    def __init__(self, tenant_id: _Optional[str] = ..., event_id: _Optional[str] = ...) -> None: ...

class GetEventResponse(_message.Message):
    __slots__ = ("id", "actor_type", "actor_ref", "action", "target_type", "target_ref", "result", "reason_code", "context_json", "occurred_at", "entry_hash")
    ID_FIELD_NUMBER: _ClassVar[int]
    ACTOR_TYPE_FIELD_NUMBER: _ClassVar[int]
    ACTOR_REF_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    TARGET_TYPE_FIELD_NUMBER: _ClassVar[int]
    TARGET_REF_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    REASON_CODE_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_JSON_FIELD_NUMBER: _ClassVar[int]
    OCCURRED_AT_FIELD_NUMBER: _ClassVar[int]
    ENTRY_HASH_FIELD_NUMBER: _ClassVar[int]
    id: str
    actor_type: str
    actor_ref: str
    action: str
    target_type: str
    target_ref: str
    result: str
    reason_code: str
    context_json: str
    occurred_at: str
    entry_hash: str
    def __init__(self, id: _Optional[str] = ..., actor_type: _Optional[str] = ..., actor_ref: _Optional[str] = ..., action: _Optional[str] = ..., target_type: _Optional[str] = ..., target_ref: _Optional[str] = ..., result: _Optional[str] = ..., reason_code: _Optional[str] = ..., context_json: _Optional[str] = ..., occurred_at: _Optional[str] = ..., entry_hash: _Optional[str] = ...) -> None: ...
