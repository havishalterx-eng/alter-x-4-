from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class ClassifyFailureRequest(_message.Message):
    __slots__ = ("tenant_id", "run_id", "node_execution_id", "error_json")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    ERROR_JSON_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    run_id: str
    node_execution_id: str
    error_json: str
    def __init__(self, tenant_id: _Optional[str] = ..., run_id: _Optional[str] = ..., node_execution_id: _Optional[str] = ..., error_json: _Optional[str] = ...) -> None: ...

class ClassifyFailureResponse(_message.Message):
    __slots__ = ("failure_class", "confidence", "root_cause_estimate_json")
    FAILURE_CLASS_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    ROOT_CAUSE_ESTIMATE_JSON_FIELD_NUMBER: _ClassVar[int]
    failure_class: str
    confidence: float
    root_cause_estimate_json: str
    def __init__(self, failure_class: _Optional[str] = ..., confidence: _Optional[float] = ..., root_cause_estimate_json: _Optional[str] = ...) -> None: ...

class SelectStrategyRequest(_message.Message):
    __slots__ = ("tenant_id", "run_id", "node_execution_id", "failure_class", "root_cause_estimate_json")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    FAILURE_CLASS_FIELD_NUMBER: _ClassVar[int]
    ROOT_CAUSE_ESTIMATE_JSON_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    run_id: str
    node_execution_id: str
    failure_class: str
    root_cause_estimate_json: str
    def __init__(self, tenant_id: _Optional[str] = ..., run_id: _Optional[str] = ..., node_execution_id: _Optional[str] = ..., failure_class: _Optional[str] = ..., root_cause_estimate_json: _Optional[str] = ...) -> None: ...

class SelectStrategyResponse(_message.Message):
    __slots__ = ("recovery_action_id", "strategy", "policy_id", "policy_version")
    RECOVERY_ACTION_ID_FIELD_NUMBER: _ClassVar[int]
    STRATEGY_FIELD_NUMBER: _ClassVar[int]
    POLICY_ID_FIELD_NUMBER: _ClassVar[int]
    POLICY_VERSION_FIELD_NUMBER: _ClassVar[int]
    recovery_action_id: str
    strategy: str
    policy_id: str
    policy_version: str
    def __init__(self, recovery_action_id: _Optional[str] = ..., strategy: _Optional[str] = ..., policy_id: _Optional[str] = ..., policy_version: _Optional[str] = ...) -> None: ...

class RecordOutcomeRequest(_message.Message):
    __slots__ = ("tenant_id", "run_id", "recovery_action_id", "strategy", "outcome")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    RECOVERY_ACTION_ID_FIELD_NUMBER: _ClassVar[int]
    STRATEGY_FIELD_NUMBER: _ClassVar[int]
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    run_id: str
    recovery_action_id: str
    strategy: str
    outcome: str
    def __init__(self, tenant_id: _Optional[str] = ..., run_id: _Optional[str] = ..., recovery_action_id: _Optional[str] = ..., strategy: _Optional[str] = ..., outcome: _Optional[str] = ...) -> None: ...

class RecordOutcomeResponse(_message.Message):
    __slots__ = ("recorded",)
    RECORDED_FIELD_NUMBER: _ClassVar[int]
    recorded: bool
    def __init__(self, recorded: _Optional[bool] = ...) -> None: ...
