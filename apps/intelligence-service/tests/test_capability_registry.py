import pytest
from pydantic import ValidationError

from src.capability_registry.models import CapabilitySearch, RegisterCapability


def record(**overrides: object) -> RegisterCapability:
    values: dict[str, object] = {
        "capability_id": "tool.search.web",
        "kind": "tool",
        "scope": "tenant",
        "supported_capabilities": ["search.web"],
        "provenance": {"source": "operator"},
    }
    values.update(overrides)
    return RegisterCapability.model_validate(values)


def test_registry_record_requires_stable_identity_and_scope() -> None:
    assert record().capability_id == "tool.search.web"
    with pytest.raises(ValidationError):
        record(capability_id="not a capability")
    with pytest.raises(ValidationError):
        record(scope="workspace")
    workspace = record(
        scope="workspace",
        workspace_id="ws_018f47a5-7b2c-7d10-8f11-123456789abc",
    )
    assert workspace.workspace_id


def test_registry_search_is_bounded_and_facts_only() -> None:
    assert CapabilitySearch(capabilities=["search.web"], limit=1).limit == 1
    with pytest.raises(ValidationError):
        CapabilitySearch(limit=101)
    with pytest.raises(ValidationError):
        record(metadata={"secret": {"not": "allowed"}})
