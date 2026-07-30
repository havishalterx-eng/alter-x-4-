from __future__ import annotations

import asyncio
import json
from collections.abc import Generator
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config as AlembicConfig
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.policy_store.models import (
    GetActivePolicyRequest,
    PromoteMemoryRequest,
    UpdatePolicyRequest,
)
from src.policy_store.repository import (
    PolicyVersionConflictError,
    SqlAlchemyPolicyStoreRepository,
)
from src.policy_store.service import PolicyStoreService, PolicyStoreValidationError

SERVICE_ROOT = Path(__file__).parent.parent
TENANT_UUID = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab"
OTHER_TENANT_UUID = "028f4d6e-2b4a-7a3e-8c1a-1234567890ab"
TENANT_ID = f"ten_{TENANT_UUID}"
EVALUATION_RUN_ID = "evr_018f4d6e-2b4a-7a3e-8c1a-1234567890ac"
SECOND_EVALUATION_RUN_ID = "evr_028f4d6e-2b4a-7a3e-8c1a-1234567890ac"
POLICY_ID = "pol_018f4d6e-2b4a-7a3e-8c1a-1234567890ad"
GLOBAL_MEMORY_ID = "mem_018f4d6e-2b4a-7a3e-8c1a-1234567890ae"
PROJECT_MEMORY_ID = "mem_018f4d6e-2b4a-7a3e-8c1a-1234567890af"
TENANT_ROLE = "know15_tenant_writer"
TENANT_PASSWORD = "know15-tenant-test-only"
SYSTEM_ROLE = "policy_system_writer"
SYSTEM_PASSWORD = "know15-system-test-only"


def _role_url(url: str, username: str, password: str) -> str:
    return make_url(url).set(username=username, password=password).render_as_string(
        hide_password=False
    )


@pytest.fixture(scope="module")
def policy_database() -> Generator[dict[str, str], None, None]:
    with PostgresContainer(image="postgres:16-alpine", dbname="policy_db") as postgres:
        admin_url = postgres.get_connection_url()
        config = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        config.set_main_option("sqlalchemy.url", admin_url)
        command.upgrade(config, "head")

        admin = sa.create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with admin.connect() as connection:
            connection.execute(
                sa.text(f"CREATE ROLE {TENANT_ROLE} LOGIN PASSWORD '{TENANT_PASSWORD}'")
            )
            connection.execute(
                sa.text(f"CREATE ROLE {SYSTEM_ROLE} LOGIN PASSWORD '{SYSTEM_PASSWORD}'")
            )
            connection.execute(
                sa.text(
                    f"GRANT CONNECT ON DATABASE policy_db TO {TENANT_ROLE}, {SYSTEM_ROLE}"
                )
            )
            connection.execute(
                sa.text(f"GRANT USAGE ON SCHEMA public TO {TENANT_ROLE}, {SYSTEM_ROLE}")
            )
            connection.execute(
                sa.text(
                    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public "
                    f"TO {TENANT_ROLE}, {SYSTEM_ROLE}"
                )
            )
        admin.dispose()
        yield {
            "admin": admin_url,
            "tenant": _role_url(admin_url, TENANT_ROLE, TENANT_PASSWORD),
            "system": _role_url(admin_url, SYSTEM_ROLE, SYSTEM_PASSWORD),
        }


@pytest.fixture
def policy_service(policy_database: dict[str, str]) -> Generator[PolicyStoreService, None, None]:
    tenant_engine = sa.create_engine(policy_database["tenant"])
    system_engine = sa.create_engine(policy_database["system"])
    repository = SqlAlchemyPolicyStoreRepository(
        sessionmaker(tenant_engine, class_=Session, expire_on_commit=False),
        sessionmaker(system_engine, class_=Session, expire_on_commit=False),
    )
    yield PolicyStoreService(repository)
    tenant_engine.dispose()
    system_engine.dispose()


def _seed_policy_database(policy_database: dict[str, str]) -> None:
    engine = sa.create_engine(policy_database["admin"])
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                """
INSERT INTO policies(id,scope,scope_id,kind,version,body,status,source)
VALUES (:id,'tenant',CAST(:tenant AS uuid),'routing_weights',1,'{}','draft','human')
ON CONFLICT (id) DO NOTHING
"""
            ),
            {"id": POLICY_ID, "tenant": TENANT_UUID},
        )
        connection.execute(
            sa.text(
                """
INSERT INTO memory_records(id,tenant_id,scope,content,provenance,status)
VALUES
  (:global_id,CAST(:tenant AS uuid),'global',CAST(:global_content AS jsonb),
   CAST(:global_provenance AS jsonb),'candidate'),
  (:project_id,CAST(:tenant AS uuid),'project',CAST(:project_content AS jsonb),
   CAST(:project_provenance AS jsonb),'candidate')
ON CONFLICT (id) DO NOTHING
"""
            ),
            {
                "global_id": GLOBAL_MEMORY_ID,
                "project_id": PROJECT_MEMORY_ID,
                "tenant": TENANT_UUID,
                "global_content": (
                    '{"tenant_id":"ten_private","run_id":"run_private",'
                    '"workspace_id":"ws_private","raw_output":"customer secret",'
                    '"final_verdict":"failed","gates":{"passed":2,"failed":1},'
                    '"recovery_count":1,"recovery_actions":['
                    '{"failure_class":"timeout","strategy":"retry",'
                    '"node_execution_id":"node_private"}],'
                    '"nodes":[{"node_type":"ToolCall","output":"secret"},'
                    '{"node_type":"AcmeCustomerIdentifier"}]}'
                ),
                "global_provenance": (
                    '{"tenant_id":"ten_private","run_id":"run_private",'
                    '"workspace_id":"ws_private","artifact_id":"art_private"}'
                ),
                "project_content": '{"summary":"preserve this exact project learning"}',
                "project_provenance": '{"run_id":"run_project_source"}',
            },
        )
    engine.dispose()


def test_policy_lifecycle_records_promotions_and_rejects_version_conflict(
    policy_database: dict[str, str],
    policy_service: PolicyStoreService,
) -> None:
    _seed_policy_database(policy_database)

    canary = asyncio.run(
        policy_service.update_policy(
            UpdatePolicyRequest(
                tenant_id=TENANT_ID,
                policy_id=POLICY_ID,
                current_version="1",
                patch_json='{"status":"canary","reason":"trial"}',
            ),
            "Bearer integration-token",
        )
    )
    active = asyncio.run(
        policy_service.update_policy(
            UpdatePolicyRequest(
                tenant_id=TENANT_ID,
                policy_id=POLICY_ID,
                current_version="2",
                patch_json='{"status":"active","reason":"healthy canary"}',
            ),
            "Bearer integration-token",
        )
    )
    assert canary.new_version == "2"
    assert active.new_version == "3"

    with pytest.raises(PolicyVersionConflictError, match="expected 2, found 3"):
        asyncio.run(
            policy_service.update_policy(
                UpdatePolicyRequest(
                    tenant_id=TENANT_ID,
                    policy_id=POLICY_ID,
                    current_version="2",
                    patch_json='{"status":"active"}',
                ),
                "Bearer integration-token",
            )
        )

    rolled_back = asyncio.run(
        policy_service.update_policy(
            UpdatePolicyRequest(
                tenant_id=TENANT_ID,
                policy_id=POLICY_ID,
                current_version="3",
                patch_json='{"status":"rolled_back","reason":"incident rollback"}',
            ),
            "Bearer integration-token",
        )
    )
    assert rolled_back.new_version == "4"

    engine = sa.create_engine(policy_database["admin"])
    with engine.connect() as connection:
        policy = connection.execute(
            sa.text("SELECT version,status FROM policies WHERE id=:id"),
            {"id": POLICY_ID},
        ).mappings().one()
        promotions = connection.execute(
            sa.text(
                "SELECT from_version,to_version,action,reason FROM policy_promotions "
                "WHERE policy_id=:id ORDER BY from_version"
            ),
            {"id": POLICY_ID},
        ).mappings().all()
    engine.dispose()
    assert policy == {"version": 4, "status": "rolled_back"}
    assert [row["action"] for row in promotions] == ["promote", "promote", "rollback"]
    assert promotions[-1]["reason"] == "incident rollback"


def test_heal6_recovery_policy_seed_is_real(policy_database: dict[str, str]) -> None:
    engine = sa.create_engine(policy_database["admin"])
    with engine.connect() as connection:
        row = connection.execute(
            sa.text(
                "SELECT id,kind,version,body,status FROM policies "
                "WHERE id='pol_00000000-0000-7000-8000-000000000001'"
            )
        ).mappings().one()
    engine.dispose()
    assert row["kind"] == "recovery_preferences"
    assert row["version"] == 1
    assert row["body"]["policy_version"] == "heal6-deterministic-v1"
    assert row["status"] == "active"


def test_get_active_policy_returns_the_real_seeded_heal6_row(
    policy_database: dict[str, str],
    policy_service: PolicyStoreService,
) -> None:
    response = asyncio.run(
        policy_service.get_active_policy(
            GetActivePolicyRequest(tenant_id=TENANT_ID, kind="recovery_preferences"),
            "Bearer integration-token",
        )
    )
    assert response.found is True
    assert response.policy_id == "pol_00000000-0000-7000-8000-000000000001"
    assert response.version == 1
    assert response.body_json is not None
    body = json.loads(response.body_json)
    assert body["rules"]["timeout"] == ["retry", "swap_agent"]
    assert body["rules"]["rate_limit"] == "backoff"


def test_get_active_policy_reports_not_found_honestly_for_an_unpromoted_kind(
    policy_database: dict[str, str],
    policy_service: PolicyStoreService,
) -> None:
    response = asyncio.run(
        policy_service.get_active_policy(
            GetActivePolicyRequest(tenant_id=TENANT_ID, kind="model_alias_map"),
            "Bearer integration-token",
        )
    )
    assert response.found is False
    assert response.policy_id is None
    assert response.body_json is None


def test_get_active_policy_prefers_new_active_version_after_promotion(
    policy_database: dict[str, str],
    policy_service: PolicyStoreService,
) -> None:
    # A dedicated draft row -- the seed row (pol_00000000-...) starts already
    # 'active', and this state machine's only legal transition out of
    # 'active' is 'rolled_back' (terminal), so it can never be walked
    # through draft->canary->active again to prove this. Real promotion
    # of a genuinely new active version needs its own fresh policy row.
    fresh_policy_id = "pol_018f4d6e-2b4a-7a3e-8c1a-11111111a001"
    engine = sa.create_engine(policy_database["admin"])
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                """
INSERT INTO policies(id,scope,scope_id,kind,version,body,status,source)
VALUES (:id,'global',NULL,'quality_thresholds',1,'{"rules":{}}','draft','human')
ON CONFLICT (id) DO NOTHING
"""
            ),
            {"id": fresh_policy_id},
        )
    engine.dispose()

    asyncio.run(
        policy_service.update_policy(
            UpdatePolicyRequest(
                tenant_id=TENANT_ID,
                policy_id=fresh_policy_id,
                current_version="1",
                patch_json='{"status":"canary","reason":"trial"}',
            ),
            "Bearer integration-token",
        )
    )
    asyncio.run(
        policy_service.update_policy(
            UpdatePolicyRequest(
                tenant_id=TENANT_ID,
                policy_id=fresh_policy_id,
                current_version="2",
                patch_json=(
                    '{"status":"active","reason":"promote",'
                    ' "body":{"rules":{"min_confidence":0.9}}}'
                ),
            ),
            "Bearer integration-token",
        )
    )

    response = asyncio.run(
        policy_service.get_active_policy(
            GetActivePolicyRequest(tenant_id=TENANT_ID, kind="quality_thresholds"),
            "Bearer integration-token",
        )
    )
    assert response.found is True
    assert response.policy_id == fresh_policy_id
    assert response.version == 3
    body = json.loads(response.body_json or "{}")
    assert body["rules"]["min_confidence"] == 0.9


def test_global_and_non_global_memory_promotion_follow_distinct_paths(
    policy_database: dict[str, str],
    policy_service: PolicyStoreService,
) -> None:
    _seed_policy_database(policy_database)
    global_result = asyncio.run(
        policy_service.promote_memory(
            PromoteMemoryRequest(
                tenant_id=TENANT_ID,
                memory_id=GLOBAL_MEMORY_ID,
                evaluation_run_id=EVALUATION_RUN_ID,
            ),
            "Bearer integration-token",
        )
    )
    project_result = asyncio.run(
        policy_service.promote_memory(
            PromoteMemoryRequest(
                tenant_id=TENANT_ID,
                memory_id=PROJECT_MEMORY_ID,
                evaluation_run_id=EVALUATION_RUN_ID,
            ),
            "Bearer integration-token",
        )
    )
    assert global_result.promoted is True
    assert project_result.promoted is True
    repeated_global = asyncio.run(
        policy_service.promote_memory(
            PromoteMemoryRequest(
                tenant_id=TENANT_ID,
                memory_id=GLOBAL_MEMORY_ID,
                evaluation_run_id=SECOND_EVALUATION_RUN_ID,
            ),
            "Bearer integration-token",
        )
    )
    assert repeated_global.promoted_at == global_result.promoted_at

    engine = sa.create_engine(policy_database["admin"])
    with engine.connect() as connection:
        global_row = connection.execute(
            sa.text(
                "SELECT tenant_id,content,provenance,status,destination "
                "FROM memory_records WHERE id=:id"
            ),
            {"id": GLOBAL_MEMORY_ID},
        ).mappings().one()
        project_row = connection.execute(
            sa.text(
                "SELECT tenant_id::text,content,provenance,status,destination "
                "FROM memory_records WHERE id=:id"
            ),
            {"id": PROJECT_MEMORY_ID},
        ).mappings().one()
    engine.dispose()

    serialized_global = str(dict(global_row))
    for sensitive in (
        "ten_private",
        "run_private",
        "ws_private",
        "art_private",
        "node_private",
        "customer secret",
    ):
        assert sensitive not in serialized_global
    assert global_row["tenant_id"] is None
    assert global_row["status"] == "promoted"
    assert global_row["destination"] == "policy_store"
    assert global_row["content"] == {
        "anonymized": True,
        "failure_classes": ["timeout"],
        "final_verdict": "failed",
        "gates": {"failed": 1, "passed": 2},
        "irreversible": True,
        "node_type_counts": {"ToolCall": 1},
        "recovery_count": 1,
        "schema": "global_memory_v1",
        "strategies": ["retry"],
    }
    assert global_row["provenance"] == {
        "promotion": {
            "anonymized": True,
            "evaluation_run_id": EVALUATION_RUN_ID,
            "irreversible": True,
            "source_identifiers_removed": True,
        }
    }
    assert project_row["tenant_id"] == TENANT_UUID
    assert project_row["content"] == {"summary": "preserve this exact project learning"}
    assert project_row["provenance"]["run_id"] == "run_project_source"
    assert project_row["provenance"]["promotion"] == {
        "evaluation_run_id": EVALUATION_RUN_ID
    }
    assert project_row["destination"] == "ads_memory_namespace"


def test_malformed_evaluation_run_id_is_rejected(
    policy_service: PolicyStoreService,
) -> None:
    with pytest.raises(PolicyStoreValidationError, match="evr_ prefixed UUIDv7"):
        asyncio.run(
            policy_service.promote_memory(
                PromoteMemoryRequest(
                    tenant_id=TENANT_ID,
                    memory_id="mem_018f4d6e-2b4a-7a3e-8c1a-1234567890aa",
                    evaluation_run_id="run_not-an-evaluation",
                ),
                "Bearer integration-token",
            )
        )


def test_plain_tenant_role_cannot_write_global_rows(
    policy_database: dict[str, str],
) -> None:
    engine = sa.create_engine(policy_database["tenant"])
    with engine.connect() as connection:
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)"),
            {"tenant": OTHER_TENANT_UUID},
        )
        with pytest.raises(sa.exc.DBAPIError):
            connection.execute(
                sa.text(
                    """
INSERT INTO policies(id,scope,scope_id,kind,version,body,status,source)
VALUES ('pol_tenant-global-denied','global',NULL,'routing_weights',99,
        '{}','draft','human')
"""
                )
            )
        connection.rollback()
        connection.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tenant, true)"),
            {"tenant": OTHER_TENANT_UUID},
        )
        with pytest.raises(sa.exc.DBAPIError):
            connection.execute(
                sa.text(
                    """
INSERT INTO memory_records(id,tenant_id,scope,content,provenance,status)
VALUES ('mem_tenant-global-denied',NULL,'global','{}','{}','candidate')
"""
                )
            )
    engine.dispose()
