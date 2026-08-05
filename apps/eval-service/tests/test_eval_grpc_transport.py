"""Real gRPC transport coverage for the global evaluation service.

The seeded golden set intentionally has no cases: that lets this transport
test assemble all production client classes from Settings while avoiding a
second copy of the downstream services' own evaluation suites.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Generator
from pathlib import Path
from uuid import UUID, uuid4

import grpc
import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from docker.errors import DockerException  # type: ignore[import-untyped]
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from alter.eval.v1 import eval_pb2, eval_pb2_grpc
from src.config import Settings
from src.db.models import EvalRun, GoldenSet
from src.grpc_server import _build_service, _close_all


@pytest.fixture()
def sessions() -> Generator[sessionmaker[Session], None, None]:
    try:
        with PostgresContainer(image="postgres:16-alpine", dbname="eval_db") as postgres:
            url = postgres.get_connection_url()
            service_root = Path(__file__).parent.parent
            alembic_config = AlembicConfig(str(service_root / "alembic.ini"))
            alembic_config.set_main_option("script_location", str(service_root / "alembic"))
            alembic_config.set_main_option("sqlalchemy.url", url)
            command.upgrade(alembic_config, "head")

            engine = sa.create_engine(url)
            with engine.connect() as connection:
                connection.execute(sa.text("CREATE ROLE eval_service NOLOGIN"))
                connection.execute(sa.text("GRANT eval_service TO CURRENT_USER"))
                connection.execute(
                    sa.text(
                        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public "
                        "TO eval_service"
                    )
                )
                connection.commit()

            @event.listens_for(engine, "connect")
            def _set_service_context(dbapi_connection: object, _record: object) -> None:
                cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
                cursor.execute("SET ROLE eval_service")
                cursor.execute("SET app.eval_internal = 'on'")
                cursor.close()

            yield sessionmaker(bind=engine, expire_on_commit=False)
    except DockerException as error:
        pytest.skip(f"Docker is unavailable for the real eval transport test: {error}")


def _settings(eval_db_url_sync: str) -> Settings:
    unused_grpc = "127.0.0.1:1"
    unused_http = "http://127.0.0.1:1"
    unused_db = "postgresql://unused:unused@127.0.0.1:1/unused"
    return Settings(
        eval_db_url_sync=eval_db_url_sync,
        grpc_bind_address="127.0.0.1:0",
        verification_grpc_target=unused_grpc,
        planner_base_url=unused_http,
        retrieval_grpc_target=unused_grpc,
        intent_grpc_target=unused_grpc,
        security_eval_base_url=unused_http,
        upload_eval_base_url=unused_http,
        tenant_isolation_retrieval_grpc_target=unused_grpc,
        toolgw_grpc_target=unused_grpc,
        recovery_grpc_target=unused_grpc,
        trigger_registry_base_url=unused_http,
        credential_base_url=unused_http,
        tool_consume_grpc_target=unused_grpc,
        idempotency_tenant_a_base_url=unused_http,
        idempotency_tenant_b_base_url="http://127.0.0.1:2",
        ingestion_base_url=unused_http,
        policy_base_url=unused_http,
        run_visibility_base_url=unused_http,
        model_gateway_grpc_target=unused_grpc,
        verification_severity_grpc_target=unused_grpc,
        audit_grpc_target=unused_grpc,
        memory_drift_base_url=unused_http,
        workflow_base_url=unused_http,
        agent_binding_base_url=unused_http,
        project_base_url=unused_http,
        orchestration_db_url=unused_db,
        platform_db_url=unused_db,
        ads_db_url=unused_db,
        policy_db_url=unused_db,
        intelligence_db_url=unused_db,
    )


def test_global_eval_service_round_trip_uses_minted_run_id_and_honest_gate_limit(
    sessions: sessionmaker[Session],
) -> None:
    golden_set_name = "grpc-transport-empty"
    with sessions.begin() as session:
        session.add(
            GoldenSet(
                id=uuid4(),
                name=golden_set_name,
                domain="verification",
                version=1,
                status="active",
            )
        )

    eval_db_url = str(sessions.kw["bind"].url)
    asyncio.run(_round_trip(eval_db_url, golden_set_name))


def test_global_eval_service_starts_and_rejects_invalid_requests() -> None:
    asyncio.run(_invalid_request_round_trip())


async def _round_trip(eval_db_url: str, golden_set_name: str) -> None:
    service, engine, clients = _build_service(_settings(eval_db_url))
    server = grpc.aio.server()
    eval_pb2_grpc.add_EvalServiceServicer_to_server(service, server)  # type: ignore[no-untyped-call]
    port = _bind_loopback_or_skip(server)
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    try:
        stub = eval_pb2_grpc.EvalServiceStub(channel)  # type: ignore[no-untyped-call]
        evaluation = await stub.RunEvaluation(
            eval_pb2.RunEvaluationRequest(golden_set_name=golden_set_name)
        )

        assert evaluation.status == "completed"
        assert evaluation.evaluation_run_id
        assert json.loads(evaluation.results_json) == {
            "failed": 0,
            "golden_set_name": golden_set_name,
            "pass_rate": 0.0,
            "passed": 0,
            "total_cases": 0,
        }
        with engine.connect() as connection:
            trigger = connection.scalar(
                sa.select(EvalRun.trigger).where(EvalRun.id == UUID(evaluation.evaluation_run_id))
            )
        assert trigger == "manual"

        gate = await stub.CheckReleaseGate(
            eval_pb2.CheckReleaseGateRequest(
                release_gate_key="engine-release",
                evaluation_run_id=evaluation.evaluation_run_id,
            )
        )
        assert gate.passed is False
        assert list(gate.failed_thresholds) == []
    finally:
        await channel.close()
        await server.stop(grace=0)
        _close_all(clients)
        engine.dispose()


async def _invalid_request_round_trip() -> None:
    service, engine, clients = _build_service(
        _settings("postgresql://unused:unused@127.0.0.1:1/unused")
    )
    server = grpc.aio.server()
    eval_pb2_grpc.add_EvalServiceServicer_to_server(service, server)  # type: ignore[no-untyped-call]
    port = _bind_loopback_or_skip(server)
    await server.start()
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{port}")
    try:
        stub = eval_pb2_grpc.EvalServiceStub(channel)  # type: ignore[no-untyped-call]
        with pytest.raises(grpc.aio.AioRpcError) as caught:
            await stub.RunEvaluation(eval_pb2.RunEvaluationRequest())
        assert caught.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    finally:
        await channel.close()
        await server.stop(grace=0)
        _close_all(clients)
        engine.dispose()


def _bind_loopback_or_skip(server: grpc.aio.Server) -> int:
    try:
        return int(server.add_insecure_port("127.0.0.1:0"))
    except RuntimeError as error:
        pytest.skip(f"loopback TCP binding is unavailable for the gRPC transport test: {error}")
