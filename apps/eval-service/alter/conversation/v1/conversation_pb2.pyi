from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class ClassifyIntentRequest(_message.Message):
    __slots__ = ("tenant_id", "workspace_id", "conversation_id", "utterance")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    UTTERANCE_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    workspace_id: str
    conversation_id: str
    utterance: str
    def __init__(self, tenant_id: _Optional[str] = ..., workspace_id: _Optional[str] = ..., conversation_id: _Optional[str] = ..., utterance: _Optional[str] = ...) -> None: ...

class ClassifyIntentResponse(_message.Message):
    __slots__ = ("intent", "confidence", "actionable")
    INTENT_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    ACTIONABLE_FIELD_NUMBER: _ClassVar[int]
    intent: str
    confidence: float
    actionable: bool
    def __init__(self, intent: _Optional[str] = ..., confidence: _Optional[float] = ..., actionable: _Optional[bool] = ...) -> None: ...

class GetGoalStateRequest(_message.Message):
    __slots__ = ("tenant_id", "conversation_id")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    conversation_id: str
    def __init__(self, tenant_id: _Optional[str] = ..., conversation_id: _Optional[str] = ...) -> None: ...

class GetGoalStateResponse(_message.Message):
    __slots__ = ("goal_state_json", "status", "revision")
    GOAL_STATE_JSON_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    goal_state_json: str
    status: str
    revision: int
    def __init__(self, goal_state_json: _Optional[str] = ..., status: _Optional[str] = ..., revision: _Optional[int] = ...) -> None: ...

class MergeClarificationRequest(_message.Message):
    __slots__ = ("tenant_id", "conversation_id", "clarification_id", "answer")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    CLARIFICATION_ID_FIELD_NUMBER: _ClassVar[int]
    ANSWER_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    conversation_id: str
    clarification_id: str
    answer: str
    def __init__(self, tenant_id: _Optional[str] = ..., conversation_id: _Optional[str] = ..., clarification_id: _Optional[str] = ..., answer: _Optional[str] = ...) -> None: ...

class MergeClarificationResponse(_message.Message):
    __slots__ = ("goal_state_json", "revision")
    GOAL_STATE_JSON_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    goal_state_json: str
    revision: int
    def __init__(self, goal_state_json: _Optional[str] = ..., revision: _Optional[int] = ...) -> None: ...
