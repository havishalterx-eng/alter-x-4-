from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class DecomposeRequest(_message.Message):
    __slots__ = ("tenant_id", "workspace_id", "run_id", "objective", "strategy")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    OBJECTIVE_FIELD_NUMBER: _ClassVar[int]
    STRATEGY_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    workspace_id: str
    run_id: str
    objective: str
    strategy: str
    def __init__(self, tenant_id: _Optional[str] = ..., workspace_id: _Optional[str] = ..., run_id: _Optional[str] = ..., objective: _Optional[str] = ..., strategy: _Optional[str] = ...) -> None: ...

class DecomposeResponse(_message.Message):
    __slots__ = ("task_skeleton_json", "ambiguity_detected", "clarification_questions")
    TASK_SKELETON_JSON_FIELD_NUMBER: _ClassVar[int]
    AMBIGUITY_DETECTED_FIELD_NUMBER: _ClassVar[int]
    CLARIFICATION_QUESTIONS_FIELD_NUMBER: _ClassVar[int]
    task_skeleton_json: str
    ambiguity_detected: bool
    clarification_questions: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, task_skeleton_json: _Optional[str] = ..., ambiguity_detected: _Optional[bool] = ..., clarification_questions: _Optional[_Iterable[str]] = ...) -> None: ...

class ReplanRequest(_message.Message):
    __slots__ = ("tenant_id", "run_id", "current_dag_json", "failure_context_json")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    CURRENT_DAG_JSON_FIELD_NUMBER: _ClassVar[int]
    FAILURE_CONTEXT_JSON_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    run_id: str
    current_dag_json: str
    failure_context_json: str
    def __init__(self, tenant_id: _Optional[str] = ..., run_id: _Optional[str] = ..., current_dag_json: _Optional[str] = ..., failure_context_json: _Optional[str] = ...) -> None: ...

class ReplanResponse(_message.Message):
    __slots__ = ("revised_skeleton_json", "reason")
    REVISED_SKELETON_JSON_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    revised_skeleton_json: str
    reason: str
    def __init__(self, revised_skeleton_json: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class SelectStrategyRequest(_message.Message):
    __slots__ = ("tenant_id", "objective", "mode")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    OBJECTIVE_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    objective: str
    mode: str
    def __init__(self, tenant_id: _Optional[str] = ..., objective: _Optional[str] = ..., mode: _Optional[str] = ...) -> None: ...

class SelectStrategyResponse(_message.Message):
    __slots__ = ("strategy", "reason")
    STRATEGY_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    strategy: str
    reason: str
    def __init__(self, strategy: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...
