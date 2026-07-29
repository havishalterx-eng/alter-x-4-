from __future__ import annotations

import json
from collections.abc import AsyncGenerator, Generator
from pathlib import Path

import grpc
import psycopg2
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.community.postgres import PostgresContainer

from alter.modelgw.v1 import modelgw_pb2, modelgw_pb2_grpc
from alter.verify.v1 import verify_pb2, verify_pb2_grpc
from src.verification.engine import HallucinationVerificationEngine
from src.verification.errors import VerificationError
from src.verification.grpc_service import VerifyGrpcService
from src.verification.ids import new_prefixed_uuid7
from src.verification.model_gateway_client import GrpcModelGatewayClient

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = REPO_ROOT / "apps" / "orchestration-service" / "drizzle"


class FakeFastModelGateway:
    def __init__(self) -> None:
        self.responses: list[str] = []
        self.requests: list[modelgw_pb2.InvokeRequest] = []

    async def Invoke(
        self,
        request: modelgw_pb2.InvokeRequest,
        context: grpc.aio.ServicerContext[modelgw_pb2.InvokeRequest, modelgw_pb2.InvokeResponse],
    ) -> modelgw_pb2.InvokeResponse:
        self.requests.append(request)
        if not self.responses:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "fixture unavailable")
        content = self.responses.pop(0)
        return modelgw_pb2.InvokeResponse(
            output_json=json.dumps(
                {"message": {"role": "assistant", "content": content}, "stop_reason": "end_turn"}
            ),
            usage_json=json.dumps({"input_tokens": 10, "output_tokens": 10}),
            resolved_capability="FAST:fixture",
        )

    async def Stream(
        self,
        request: modelgw_pb2.StreamRequest,
        context: grpc.aio.ServicerContext[modelgw_pb2.StreamRequest, modelgw_pb2.StreamResponse],
    ) -> AsyncGenerator[modelgw_pb2.StreamResponse, None]:
        del request
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "not used by classifier")
        if False:
            yield modelgw_pb2.StreamResponse()

    async def Redact(
        self,
        request: modelgw_pb2.RedactRequest,
        context: grpc.aio.ServicerContext[modelgw_pb2.RedactRequest, modelgw_pb2.RedactResponse],
    ) -> modelgw_pb2.RedactResponse:
        del request
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "not used by classifier")
        raise AssertionError("context.abort must raise")

    async def SelectFallback(
        self,
        request: modelgw_pb2.SelectFallbackRequest,
        context: grpc.aio.ServicerContext[
            modelgw_pb2.SelectFallbackRequest, modelgw_pb2.SelectFallbackResponse
        ],
    ) -> modelgw_pb2.SelectFallbackResponse:
        del request
        await context.abort(grpc.StatusCode.UNIMPLEMENTED, "not used by classifier")
        raise AssertionError("context.abort must raise")


@pytest.fixture(scope="module")
def postgres_url() -> Generator[str, None, None]:
    with PostgresContainer(
        image="postgres:16-alpine",
        dbname="orchestration_db",
        username="postgres",
        password="postgres",
    ) as postgres:
        url = (
            make_url(postgres.get_connection_url())
            .set(drivername="postgresql")
            .render_as_string(hide_password=False)
        )
        connection = psycopg2.connect(url)
        connection.autocommit = True
        try:
            with connection.cursor() as cursor:
                for migration in sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql")):
                    for statement in migration.read_text().split("--> statement-breakpoint"):
                        if statement.strip():
                            cursor.execute(statement)
                cursor.execute("CREATE ROLE verification_runtime NOLOGIN")
                cursor.execute(
                    "GRANT SELECT ON workflows, workflow_versions, runs, node_executions, "
                    "blackboard_checkpoints TO verification_runtime"
                )
                cursor.execute(
                    "GRANT INSERT, SELECT ON verification_results TO verification_runtime"
                )
        finally:
            connection.close()
        yield url


@pytest.fixture
async def database(postgres_url: str) -> AsyncGenerator[AsyncEngine, None]:
    parsed = make_url(postgres_url)
    async_url = parsed.set(drivername="postgresql+asyncpg")
    engine = create_async_engine(
        async_url,
        connect_args={"server_settings": {"role": "verification_runtime"}},
    )
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture
async def model_gateway() -> AsyncGenerator[tuple[FakeFastModelGateway, str], None]:
    implementation = FakeFastModelGateway()
    server = grpc.aio.server()
    modelgw_pb2_grpc.add_ModelgwServiceServicer_to_server(  # type: ignore[no-untyped-call]
        implementation, server
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    try:
        yield implementation, f"127.0.0.1:{port}"
    finally:
        await server.stop(grace=0)


@pytest.fixture
def seeded_ids(postgres_url: str) -> dict[str, str]:
    ids = {
        "tenant": new_prefixed_uuid7("ten"),
        "other_tenant": new_prefixed_uuid7("ten"),
        "workspace": new_prefixed_uuid7("ws"),
        "workflow": new_prefixed_uuid7("wf"),
        "version": new_prefixed_uuid7("wfv"),
        "run": new_prefixed_uuid7("run"),
        "node": new_prefixed_uuid7("node"),
    }
    tenant_uuid = ids["tenant"].split("_", 1)[1]
    workspace_uuid = ids["workspace"].split("_", 1)[1]
    dag = {
        "schema_version": "1",
        "entry_node_keys": ["evidence"],
        "nodes": [
            {"key": "evidence", "type": "ToolCall", "config": {}, "metadata": {"ui": {}}},
            {
                "key": "answer",
                "type": "LLMTask",
                "config": {"task": "Answer only from supplied evidence"},
                "metadata": {"ui": {}},
            },
        ],
        "edges": [{"key": "e1", "from": "evidence", "to": "answer", "kind": "sequential"}],
        "waves": [
            {"key": "w1", "order": 0, "node_keys": ["evidence"], "depends_on": []},
            {"key": "w2", "order": 1, "node_keys": ["answer"], "depends_on": ["w1"]},
        ],
    }
    connection = psycopg2.connect(postgres_url)
    try:
        with connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO workflows (id, tenant_id, workspace_id, name) "
                "VALUES (%s,%s,%s,'verify')",
                (ids["workflow"], tenant_uuid, workspace_uuid),
            )
            cursor.execute(
                "INSERT INTO workflow_versions "
                "(id,tenant_id,workflow_id,version,compiled_dag,dag_schema_version) "
                "VALUES (%s,%s,%s,1,%s::jsonb,'1')",
                (ids["version"], tenant_uuid, ids["workflow"], json.dumps(dag)),
            )
            cursor.execute(
                "INSERT INTO runs "
                "(id,tenant_id,workspace_id,parent_kind,workflow_id,workflow_version_id,status) "
                "VALUES (%s,%s,%s,'workflow',%s,%s,'running')",
                (ids["run"], tenant_uuid, workspace_uuid, ids["workflow"], ids["version"]),
            )
            cursor.execute(
                "INSERT INTO node_executions "
                "(id,tenant_id,run_id,dag_node_id,node_type,status,input_ref,output_ref) "
                "VALUES (%s,%s,%s,'answer','LLMTask','succeeded','evidence','answer')",
                (ids["node"], tenant_uuid, ids["run"]),
            )
            cursor.execute(
                "INSERT INTO blackboard_checkpoints (tenant_id,run_id,context_key,value_json) "
                "VALUES (%s,%s,'evidence',%s::jsonb),(%s,%s,'answer',%s::jsonb)",
                (
                    tenant_uuid,
                    ids["run"],
                    json.dumps({"fact": "Paris is France's capital"}),
                    tenant_uuid,
                    ids["run"],
                    json.dumps({"answer": "Paris"}),
                ),
            )
    finally:
        connection.close()
    return ids


async def _engine(
    database: AsyncEngine, target: str
) -> AsyncGenerator[tuple[HallucinationVerificationEngine, GrpcModelGatewayClient], None]:
    async with AsyncSession(database, expire_on_commit=False) as session:
        client = GrpcModelGatewayClient(target, timeout_seconds=1)
        try:
            yield HallucinationVerificationEngine(session, client), client
        finally:
            await client.close()


@pytest.mark.parametrize(
    ("score", "verdict", "reason"),
    [
        (0.98, "fail", "The claimed moon capital has no evidence"),
        (0.02, "pass", "The answer is directly supported"),
    ],
)
async def test_real_fast_grpc_call_classifies_seeded_outputs_and_persists(
    database: AsyncEngine,
    model_gateway: tuple[FakeFastModelGateway, str],
    seeded_ids: dict[str, str],
    postgres_url: str,
    score: float,
    verdict: str,
    reason: str,
) -> None:
    fake, target = model_gateway
    response_value = (
        {"answer": "The Moon City is France's capital"}
        if verdict == "fail"
        else {"answer": "Paris"}
    )
    connection = psycopg2.connect(postgres_url)
    try:
        with connection, connection.cursor() as cursor:
            cursor.execute(
                "UPDATE blackboard_checkpoints SET value_json=%s::jsonb "
                "WHERE run_id=%s AND context_key='answer'",
                (json.dumps(response_value), seeded_ids["run"]),
            )
    finally:
        connection.close()
    fake.responses.append(
        json.dumps(
            {
                "hallucination_score": score,
                "verdict": verdict,
                "flagged_spans": []
                if verdict == "pass"
                else [{"text": "moon capital", "reason": reason}],
                "reasons": [reason],
            }
        )
    )
    async for engine, _ in _engine(database, target):
        result = await engine.check_hallucination(
            tenant_id=seeded_ids["tenant"],
            run_id=seeded_ids["run"],
            node_execution_id=seeded_ids["node"],
            response_node_ref="answer",
            evidence_node_refs=("evidence",),
        )
    assert result.assessment.verdict == verdict
    assert fake.requests[-1].model_alias == "FAST"
    assert response_value["answer"] in fake.requests[-1].input_json

    tenant_uuid = seeded_ids["tenant"].split("_", 1)[1]
    async with AsyncSession(database) as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :t, true)"), {"t": tenant_uuid}
        )
        row = (
            (
                await session.execute(
                    text(
                        "SELECT gate_type, verdict, details FROM verification_results WHERE id=:id"
                    ),
                    {"id": result.verification_result_id},
                )
            )
            .mappings()
            .one()
        )
    assert row["gate_type"] == "hallucination"
    assert row["verdict"] == verdict
    assert row["details"]["reasons"] == [reason]


async def test_safety_escalation_critical_maps_to_terminate(
    database: AsyncEngine,
    model_gateway: tuple[FakeFastModelGateway, str],
    seeded_ids: dict[str, str],
) -> None:
    fake, target = model_gateway
    fake.responses.append(
        json.dumps({"severity": "critical", "rationale": "Unsafe external action"})
    )
    async for engine, _ in _engine(database, target):
        result = await engine.assess_severity(
            tenant_id=seeded_ids["tenant"],
            run_id=seeded_ids["run"],
            node_execution_id=seeded_ids["node"],
            finding_json=json.dumps({"policy_violation": "credential exfiltration"}),
        )
    assert result.assessment.severity == "critical"
    assert result.assessment.recovery_signal == "terminate"


async def test_real_verify_grpc_response_uses_locked_severity_enum(
    database: AsyncEngine,
    model_gateway: tuple[FakeFastModelGateway, str],
    seeded_ids: dict[str, str],
) -> None:
    fake, model_target = model_gateway
    fake.responses.append(json.dumps({"severity": "high", "rationale": "Heal before retry"}))
    model_client = GrpcModelGatewayClient(model_target)
    server = grpc.aio.server()
    verify_pb2_grpc.add_VerifyServiceServicer_to_server(  # type: ignore[no-untyped-call]
        VerifyGrpcService(async_sessionmaker(database, expire_on_commit=False), model_client),
        server,
    )
    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    stub = verify_pb2_grpc.VerifyServiceStub(channel)  # type: ignore[no-untyped-call]
    try:
        response = await stub.AssessSeverity(
            verify_pb2.AssessSeverityRequest(
                tenant_id=seeded_ids["tenant"],
                run_id=seeded_ids["run"],
                node_execution_id=seeded_ids["node"],
                finding_json=json.dumps({"issue": "repairable"}),
            )
        )
    finally:
        await channel.close()
        await server.stop(grace=0)
        await model_client.close()
    assert response.severity_tier == verify_pb2.SAFETY_SEVERITY_HIGH
    assert response.severity == "high"
    assert response.rationale == "Heal before retry"
    assert (
        verify_pb2.CheckHallucinationRequest.DESCRIPTOR.fields_by_name[
            "response_artifact_id"
        ].GetOptions().deprecated
        is True
    )


async def test_classifier_call_failure_is_persisted_fail_closed(
    database: AsyncEngine,
    seeded_ids: dict[str, str],
) -> None:
    async for engine, _ in _engine(database, "127.0.0.1:1"):
        with pytest.raises(VerificationError) as caught:
            await engine.check_hallucination(
                tenant_id=seeded_ids["tenant"],
                run_id=seeded_ids["run"],
                node_execution_id=seeded_ids["node"],
                response_node_ref="answer",
                evidence_node_refs=("evidence",),
            )
    problem = caught.value.problem
    assert problem.error_code == "HALLUCINATION_VERIFICATION_FAILED"
    assert problem.retryable is True
    assert problem.trace_id.startswith("trc_")
    assert problem.request_id.startswith("req_")

    tenant_uuid = seeded_ids["tenant"].split("_", 1)[1]
    async with AsyncSession(database) as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :t, true)"), {"t": tenant_uuid}
        )
        details = (
            await session.execute(
                text(
                    "SELECT details FROM verification_results "
                    "WHERE gate_type='hallucination' AND details->>'verification_status'='failed'"
                )
            )
        ).scalar_one()
    assert details["problem"]["error_code"] == "HALLUCINATION_VERIFICATION_FAILED"


async def test_cross_tenant_node_access_is_rejected_before_model_call(
    database: AsyncEngine,
    model_gateway: tuple[FakeFastModelGateway, str],
    seeded_ids: dict[str, str],
) -> None:
    fake, target = model_gateway
    calls_before = len(fake.requests)
    async for engine, _ in _engine(database, target):
        with pytest.raises(VerificationError) as caught:
            await engine.check_hallucination(
                tenant_id=seeded_ids["other_tenant"],
                run_id=seeded_ids["run"],
                node_execution_id=seeded_ids["node"],
                response_node_ref="answer",
                evidence_node_refs=("evidence",),
            )
    assert caught.value.problem.error_code == "VERIFICATION_INPUT_UNAVAILABLE"
    assert len(fake.requests) == calls_before


async def test_artifact_ids_cannot_be_used_as_node_references(
    database: AsyncEngine,
    model_gateway: tuple[FakeFastModelGateway, str],
    seeded_ids: dict[str, str],
) -> None:
    _, target = model_gateway
    async for engine, _ in _engine(database, target):
        with pytest.raises(VerificationError) as caught:
            await engine.check_hallucination(
                tenant_id=seeded_ids["tenant"],
                run_id=seeded_ids["run"],
                node_execution_id=seeded_ids["node"],
                response_node_ref="art_invalid/value",
                evidence_node_refs=(),
            )
    assert caught.value.problem.error_code == "INVALID_NODE_REFERENCE"
