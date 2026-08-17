import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.architecture_synthesizer.models import (
    ArchitectureNode,
    ArchitectureSpec,
    EligibleCapabilityRole,
    ExecutionWave,
    SynthesisConstraints,
)
from src.capability_registry.models import CapabilityRecord
from src.selection_binding.architecture_binder import ArchitectureBinder
from src.selection_binding.models import BindingBlocked, BindingPolicy, BindingRequest
from src.selection_binding.router import router

TENANT = "ten_aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa"
WORKSPACE = "ws_bbbbbbbb-0000-7000-8000-bbbbbbbbbbbb"


class Registry:
    def __init__(self, records: list[CapabilityRecord]) -> None:
        self.records = records

    async def search(self, *args: object, **kwargs: object) -> list[CapabilityRecord]:
        return self.records


def record(
    identifier: str, *, reliability: float = 0.8, available: bool = True
) -> CapabilityRecord:
    return CapabilityRecord.model_validate(
        {
            "capability_id": identifier,
            "version": 2,
            "owner_tenant_id": "aaaaaaaa-0000-7000-8000-aaaaaaaaaaaa",
            "kind": "model",
            "scope": "workspace",
            "workspace_id": WORKSPACE,
            "supported_capabilities": ["text.generation"],
            "availability": {
                "available": available, "reliability": reliability, "latency_ms_p50": 100,
                "cost_unit": "request", "cost_amount": 0.1,
            },
            "provenance": {"source": "test"},
            "status": "active",
        }
    )


def request(policy: BindingPolicy | None = None) -> BindingRequest:
    return BindingRequest(
        tenant_id=TENANT,
        workspace_id=WORKSPACE,
        architecture=ArchitectureSpec(
            source_task_skeleton_version="1",
            topology="single",
            constraints=SynthesisConstraints(),
            nodes=[
                ArchitectureNode(
                    source_node_key="node", role="direct", execution_kind="llm", depends_on=[],
                    capability_role=EligibleCapabilityRole(
                        source_node_key="node", required_capabilities=["text.generation"],
                        eligible_kinds=["model"],
                    ),
                )
            ],
            execution_waves=[ExecutionWave(order=0, node_keys=["node"])],
            rationale=["test"],
            confidence=1,
        ),
        policy=policy or BindingPolicy(),
    )


@pytest.mark.asyncio
async def test_binding_is_policy_filtered_and_version_pinned() -> None:
    records = [record("low", reliability=0.6), record("high", reliability=0.9)]
    binder = ArchitectureBinder(Registry(records))  # type: ignore[arg-type]
    outcome = await binder.bind(request())
    assert outcome.status == "ready"
    assert outcome.bindings[0].record_id == "high"
    assert outcome.bindings[0].version == 2


@pytest.mark.asyncio
async def test_no_policy_eligible_candidate_blocks() -> None:
    binder = ArchitectureBinder(Registry([record("inactive", available=False)]))  # type: ignore[arg-type]
    outcome = await binder.bind(request(BindingPolicy(allowed_kinds=["tool"])))
    assert isinstance(outcome, BindingBlocked)


def test_zero_score_weights_are_rejected_at_route_boundary() -> None:
    app = FastAPI()
    app.include_router(router)
    payload = request().model_dump(mode="json")
    payload["policy"] = {"reliability_weight": 0, "latency_weight": 0, "cost_weight": 0}
    response = TestClient(app).post("/selection-binding/bind-architecture", json=payload)
    assert response.status_code == 422
