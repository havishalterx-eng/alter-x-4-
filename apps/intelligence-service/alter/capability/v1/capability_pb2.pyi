from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class ResolveNodeRequirementsRequest(_message.Message):
    __slots__ = ("tenant_id", "run_id", "node_key", "node_type", "node_config_json")
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_KEY_FIELD_NUMBER: _ClassVar[int]
    NODE_TYPE_FIELD_NUMBER: _ClassVar[int]
    NODE_CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    tenant_id: str
    run_id: str
    node_key: str
    node_type: str
    node_config_json: str
    def __init__(self, tenant_id: _Optional[str] = ..., run_id: _Optional[str] = ..., node_key: _Optional[str] = ..., node_type: _Optional[str] = ..., node_config_json: _Optional[str] = ...) -> None: ...

class ResolveNodeRequirementsResponse(_message.Message):
    __slots__ = ("node_requirements_json", "schema_version")
    NODE_REQUIREMENTS_JSON_FIELD_NUMBER: _ClassVar[int]
    SCHEMA_VERSION_FIELD_NUMBER: _ClassVar[int]
    node_requirements_json: str
    schema_version: str
    def __init__(self, node_requirements_json: _Optional[str] = ..., schema_version: _Optional[str] = ...) -> None: ...
