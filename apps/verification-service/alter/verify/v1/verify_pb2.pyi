from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SafetySeverity(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SAFETY_SEVERITY_UNSPECIFIED: _ClassVar[SafetySeverity]
    SAFETY_SEVERITY_LOW: _ClassVar[SafetySeverity]
    SAFETY_SEVERITY_MEDIUM: _ClassVar[SafetySeverity]
    SAFETY_SEVERITY_HIGH: _ClassVar[SafetySeverity]
    SAFETY_SEVERITY_CRITICAL: _ClassVar[SafetySeverity]
SAFETY_SEVERITY_UNSPECIFIED: SafetySeverity
SAFETY_SEVERITY_LOW: SafetySeverity
SAFETY_SEVERITY_MEDIUM: SafetySeverity
SAFETY_SEVERITY_HIGH: SafetySeverity
SAFETY_SEVERITY_CRITICAL: SafetySeverity

class ScoreGateRequest(_message.Message):
    __slots__ = ("tenant_id", "run_id", "node_execution_id", "gate_type", "evidence_artifact_ids")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    GATE_TYPE_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_ARTIFACT_IDS_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    run_id: str
    node_execution_id: str
    gate_type: str
    evidence_artifact_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, tenant_id: _Optional[str] = ..., run_id: _Optional[str] = ..., node_execution_id: _Optional[str] = ..., gate_type: _Optional[str] = ..., evidence_artifact_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ScoreGateResponse(_message.Message):
    __slots__ = ("verification_result_id", "verdict", "score")
    VERIFICATION_RESULT_ID_FIELD_NUMBER: _ClassVar[int]
    VERDICT_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    verification_result_id: str
    verdict: str
    score: float
    def __init__(self, verification_result_id: _Optional[str] = ..., verdict: _Optional[str] = ..., score: _Optional[float] = ...) -> None: ...

class CheckHallucinationRequest(_message.Message):
    __slots__ = ("tenant_id", "run_id", "node_execution_id", "response_artifact_id", "evidence_artifact_ids", "response_node_ref", "evidence_node_refs")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_ARTIFACT_ID_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_ARTIFACT_IDS_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_NODE_REF_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_NODE_REFS_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    run_id: str
    node_execution_id: str
    response_artifact_id: str
    evidence_artifact_ids: _containers.RepeatedScalarFieldContainer[str]
    response_node_ref: str
    evidence_node_refs: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, tenant_id: _Optional[str] = ..., run_id: _Optional[str] = ..., node_execution_id: _Optional[str] = ..., response_artifact_id: _Optional[str] = ..., evidence_artifact_ids: _Optional[_Iterable[str]] = ..., response_node_ref: _Optional[str] = ..., evidence_node_refs: _Optional[_Iterable[str]] = ...) -> None: ...

class CheckHallucinationResponse(_message.Message):
    __slots__ = ("verification_result_id", "verdict", "confidence")
    VERIFICATION_RESULT_ID_FIELD_NUMBER: _ClassVar[int]
    VERDICT_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    verification_result_id: str
    verdict: str
    confidence: float
    def __init__(self, verification_result_id: _Optional[str] = ..., verdict: _Optional[str] = ..., confidence: _Optional[float] = ...) -> None: ...

class AssessSeverityRequest(_message.Message):
    __slots__ = ("tenant_id", "run_id", "node_execution_id", "finding_json")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    FINDING_JSON_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    run_id: str
    node_execution_id: str
    finding_json: str
    def __init__(self, tenant_id: _Optional[str] = ..., run_id: _Optional[str] = ..., node_execution_id: _Optional[str] = ..., finding_json: _Optional[str] = ...) -> None: ...

class AssessSeverityResponse(_message.Message):
    __slots__ = ("severity", "rationale", "severity_tier")
    SEVERITY_FIELD_NUMBER: _ClassVar[int]
    RATIONALE_FIELD_NUMBER: _ClassVar[int]
    SEVERITY_TIER_FIELD_NUMBER: _ClassVar[int]
    severity: str
    rationale: str
    severity_tier: SafetySeverity
    def __init__(self, severity: _Optional[str] = ..., rationale: _Optional[str] = ..., severity_tier: _Optional[_Union[SafetySeverity, str]] = ...) -> None: ...
