from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ProblemContextReference(_message.Message):
    __slots__ = ("document_id", "chunk_reference", "confidence", "provenance_json")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_REFERENCE_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    PROVENANCE_JSON_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    chunk_reference: str
    confidence: float
    provenance_json: str
    def __init__(self, document_id: _Optional[str] = ..., chunk_reference: _Optional[str] = ..., confidence: _Optional[float] = ..., provenance_json: _Optional[str] = ...) -> None: ...

class ProblemSpec(_message.Message):
    __slots__ = ("objective", "current_situation", "actors", "systems_involved", "constraints", "required_data", "risk", "missing_information", "success_criteria", "context_references")
    OBJECTIVE_FIELD_NUMBER: _ClassVar[int]
    CURRENT_SITUATION_FIELD_NUMBER: _ClassVar[int]
    ACTORS_FIELD_NUMBER: _ClassVar[int]
    SYSTEMS_INVOLVED_FIELD_NUMBER: _ClassVar[int]
    CONSTRAINTS_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_DATA_FIELD_NUMBER: _ClassVar[int]
    RISK_FIELD_NUMBER: _ClassVar[int]
    MISSING_INFORMATION_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_CRITERIA_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_REFERENCES_FIELD_NUMBER: _ClassVar[int]
    objective: str
    current_situation: str
    actors: _containers.RepeatedScalarFieldContainer[str]
    systems_involved: _containers.RepeatedScalarFieldContainer[str]
    constraints: _containers.RepeatedScalarFieldContainer[str]
    required_data: _containers.RepeatedScalarFieldContainer[str]
    risk: str
    missing_information: _containers.RepeatedScalarFieldContainer[str]
    success_criteria: _containers.RepeatedScalarFieldContainer[str]
    context_references: _containers.RepeatedCompositeFieldContainer[ProblemContextReference]
    def __init__(self, objective: _Optional[str] = ..., current_situation: _Optional[str] = ..., actors: _Optional[_Iterable[str]] = ..., systems_involved: _Optional[_Iterable[str]] = ..., constraints: _Optional[_Iterable[str]] = ..., required_data: _Optional[_Iterable[str]] = ..., risk: _Optional[str] = ..., missing_information: _Optional[_Iterable[str]] = ..., success_criteria: _Optional[_Iterable[str]] = ..., context_references: _Optional[_Iterable[_Union[ProblemContextReference, _Mapping]]] = ...) -> None: ...

class DecomposeRequest(_message.Message):
    __slots__ = ("tenant_id", "workspace_id", "run_id", "objective", "strategy", "problem_spec_json")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    OBJECTIVE_FIELD_NUMBER: _ClassVar[int]
    STRATEGY_FIELD_NUMBER: _ClassVar[int]
    PROBLEM_SPEC_JSON_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    workspace_id: str
    run_id: str
    objective: str
    strategy: str
    problem_spec_json: str
    def __init__(self, tenant_id: _Optional[str] = ..., workspace_id: _Optional[str] = ..., run_id: _Optional[str] = ..., objective: _Optional[str] = ..., strategy: _Optional[str] = ..., problem_spec_json: _Optional[str] = ...) -> None: ...

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
