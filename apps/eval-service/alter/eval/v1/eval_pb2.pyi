from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class RunEvaluationRequest(_message.Message):
    __slots__ = ("golden_set_name",)
    GOLDEN_SET_NAME_FIELD_NUMBER: _ClassVar[int]
    golden_set_name: str
    def __init__(self, golden_set_name: _Optional[str] = ...) -> None: ...

class RunEvaluationResponse(_message.Message):
    __slots__ = ("evaluation_run_id", "status", "results_json")
    EVALUATION_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    RESULTS_JSON_FIELD_NUMBER: _ClassVar[int]
    evaluation_run_id: str
    status: str
    results_json: str
    def __init__(self, evaluation_run_id: _Optional[str] = ..., status: _Optional[str] = ..., results_json: _Optional[str] = ...) -> None: ...

class CheckReleaseGateRequest(_message.Message):
    __slots__ = ("release_gate_key", "evaluation_run_id")
    RELEASE_GATE_KEY_FIELD_NUMBER: _ClassVar[int]
    EVALUATION_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    release_gate_key: str
    evaluation_run_id: str
    def __init__(self, release_gate_key: _Optional[str] = ..., evaluation_run_id: _Optional[str] = ...) -> None: ...

class CheckReleaseGateResponse(_message.Message):
    __slots__ = ("passed", "failed_thresholds")
    PASSED_FIELD_NUMBER: _ClassVar[int]
    FAILED_THRESHOLDS_FIELD_NUMBER: _ClassVar[int]
    passed: bool
    failed_thresholds: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, passed: _Optional[bool] = ..., failed_thresholds: _Optional[_Iterable[str]] = ...) -> None: ...
