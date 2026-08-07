from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class RunEvaluationRequest(_message.Message):
    __slots__ = ("tenant_id", "evaluation_run_id", "golden_set_reference", "candidate_version", "golden_set_name", "trigger")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    EVALUATION_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    GOLDEN_SET_REFERENCE_FIELD_NUMBER: _ClassVar[int]
    CANDIDATE_VERSION_FIELD_NUMBER: _ClassVar[int]
    GOLDEN_SET_NAME_FIELD_NUMBER: _ClassVar[int]
    TRIGGER_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    evaluation_run_id: str
    golden_set_reference: str
    candidate_version: str
    golden_set_name: str
    trigger: str
    def __init__(self, tenant_id: _Optional[str] = ..., evaluation_run_id: _Optional[str] = ..., golden_set_reference: _Optional[str] = ..., candidate_version: _Optional[str] = ..., golden_set_name: _Optional[str] = ..., trigger: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("tenant_id", "release_gate_key", "evaluation_run_id")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RELEASE_GATE_KEY_FIELD_NUMBER: _ClassVar[int]
    EVALUATION_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    release_gate_key: str
    evaluation_run_id: str
    def __init__(self, tenant_id: _Optional[str] = ..., release_gate_key: _Optional[str] = ..., evaluation_run_id: _Optional[str] = ...) -> None: ...

class CheckReleaseGateResponse(_message.Message):
    __slots__ = ("passed", "failed_thresholds")
    PASSED_FIELD_NUMBER: _ClassVar[int]
    FAILED_THRESHOLDS_FIELD_NUMBER: _ClassVar[int]
    passed: bool
    failed_thresholds: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, passed: _Optional[bool] = ..., failed_thresholds: _Optional[_Iterable[str]] = ...) -> None: ...
