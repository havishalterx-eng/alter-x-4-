"""Real-Postgres coverage for PLAN-8 agent auto-creation."""

import json
import uuid
from collections.abc import AsyncGenerator, Generator, Sequence
from pathlib import Path

import pytest
from alembic.config import Config as AlembicConfig
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from testcontainers.community.postgres import PostgresContainer

from alembic import command
from src.agent_auto_creation import (
    AgentAutoCreationEngine,
    CreatePersonaRequest,
    CreatePersonaResponse,
    PersonaCreationValidationError,
)
from src.capability_resolver import NodeRequirement, NodeRequirements, ToolRequirement
from src.db.ids import new_prefixed_id
from src.selection_binding import (
    BindAgentModelToolRequest,
    BindAgentModelToolResponse,
    BindingContext,
    EmbeddingResultError,
    NoAgentMatch,
    SelectionBindingEngine,
)

SERVICE_ROOT = Path(__file__).parent.parent
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"

TENANT_A = "ten_018f47a5-7b2c-7d10-8f11-123456789abc"
TENANT_B = "ten_028f47a5-7b2c-7d10-8f11-123456789abc"
WORKSPACE_A = "ws_018f47a5-7b2c-7d10-8f11-123456789abc"
RUN_ID = "run_018f47a5-7b2c-7d10-8f11-123456789abc"


class FakeEmbeddingClient:
    def __init__(self, vector: Sequence[float]) -> None:
        self.vector = vector
        self.calls: list[tuple[str, str]] = []

    async def embed(self, *, tenant_id: str, text: str) -> Sequence[float]:
        self.calls.append((tenant_id, text))
        return self.vector


def vector(first: float, second: float = 0.0) -> list[float]:
    return [first, second, *([0.0] * 510)]


@pytest.fixture(scope="module")
def postgres_url() -> Generator[str, None, None]:
    with PostgresContainer(
        image=PGVECTOR_IMAGE,
        dbname="intelligence_db",
        username="intelligence_service",
        password="testpass",
    ) as postgres:
        sync_url = postgres.get_connection_url()
        alembic_config = AlembicConfig(str(SERVICE_ROOT / "alembic.ini"))
        alembic_config.set_main_option(
            "script_location",
            str(SERVICE_ROOT / "alembic"),
        )
        alembic_config.set_main_option("sqlalchemy.url", sync_url)
        command.upgrade(alembic_config, "head")
        yield sync_url


@pytest.fixture
async def db_session(postgres_url: str) -> AsyncGenerator[AsyncSession, None]:
    async_url = make_url(postgres_url).set(drivername="postgresql+asyncpg")
    engine = create_async_engine(async_url)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        yield session
        await session.rollback()
    await engine.dispose()


def create_request(
    requirement: NodeRequirement,
    *,
    tenant_id: str = TENANT_A,
) -> CreatePersonaRequest:
    return CreatePersonaRequest(
        tenant_id=tenant_id,
        workspace_id=WORKSPACE_A,
        capability_profile_json=requirement.model_dump_json(exclude_none=True),
    )


def binding_request(
    requirement: NodeRequirement,
    *,
    tenant_id: str = TENANT_A,
) -> BindAgentModelToolRequest:
    requirements = NodeRequirements(root={"node.one": requirement})
    return BindAgentModelToolRequest(
        tenant_id=tenant_id,
        run_id=RUN_ID,
        node_key="node.one",
        node_requirements_json=requirements.model_dump_json(exclude_none=True),
    )


def binding_context() -> BindingContext:
    return BindingContext(
        workspace_id=WORKSPACE_A,
        node_type="LLMTask",
        task_category="analysis",
    )


def true_no_match() -> NoAgentMatch:
    return NoAgentMatch(node_key="node.one", reason="no_eligible_agent")


async def table_counts(session: AsyncSession) -> tuple[int, int, int]:
    result = await session.execute(
        text(
            """
SELECT
  (SELECT count(*) FROM agents),
  (SELECT count(*) FROM agent_versions),
  (SELECT count(*) FROM capability_embeddings)
"""
        )
    )
    row = result.one()
    return int(row[0]), int(row[1]), int(row[2])


class TestCreatePersonaContract:
    def test_response_matches_locked_proto_fields(self) -> None:
        agent_id = new_prefixed_id("agt", now_ms=1_700_000_000_000)
        response = CreatePersonaResponse(
            agent_id=agent_id,
            agent_version=1,
            persona_json='{"tier":"STANDARD"}',
        )

        assert response.model_dump() == {
            "agent_id": agent_id,
            "agent_version": 1,
            "persona_json": '{"tier":"STANDARD"}',
        }

    def test_contract_models_reject_extra_fields(self) -> None:
        with pytest.raises(ValidationError):
            CreatePersonaRequest.model_validate(
                {
                    **create_request(NodeRequirement(capabilities=["analysis"])).model_dump(),
                    "invented": True,
                }
            )

    def test_generated_ids_are_uuidv7(self) -> None:
        timestamp_ms = 1_700_000_000_000

        generated = new_prefixed_id("agt", now_ms=timestamp_ms)
        parsed = uuid.UUID(generated.removeprefix("agt_"))

        assert parsed.version == 7
        assert parsed.variant == uuid.RFC_4122
        assert int.from_bytes(parsed.bytes[0:6], byteorder="big") == timestamp_ms

    @pytest.mark.parametrize("invalid_timestamp", [-1, 0x1_0000_0000_0000])
    def test_uuidv7_rejects_timestamp_outside_48_bits(
        self,
        invalid_timestamp: int,
    ) -> None:
        with pytest.raises(ValueError, match="48-bit"):
            new_prefixed_id("agt", now_ms=invalid_timestamp)


class TestAgentAutoCreationIntegration:
    @pytest.mark.parametrize(
        "reason",
        ["agent_not_required", "preferred_agent_unavailable"],
    )
    async def test_non_trigger_reasons_return_unchanged_without_side_effects(
        self,
        db_session: AsyncSession,
        reason: str,
    ) -> None:
        no_match = NoAgentMatch.model_validate(
            {"node_key": "node.one", "reason": reason}
        )
        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = AgentAutoCreationEngine(db_session, embedding_client)
        request = CreatePersonaRequest(
            tenant_id=TENANT_A,
            workspace_id=WORKSPACE_A,
            capability_profile_json="not-json",
        )

        outcome = await engine.create_for_no_match(no_match, request)

        assert outcome is no_match
        assert embedding_client.calls == []
        assert await table_counts(db_session) == (0, 0, 0)

    async def test_creates_active_standard_published_persona_and_embedding(
        self,
        db_session: AsyncSession,
    ) -> None:
        requirement = NodeRequirement(
            capabilities=["analysis.reasoning", "document.synthesis"],
            model_alias="CEILING",
            tools=[ToolRequirement(name="search.web", permissions=["web:read"])],
            maximum_input_bytes=4096,
        )
        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = AgentAutoCreationEngine(db_session, embedding_client)

        outcome = await engine.create_for_no_match(
            true_no_match(),
            create_request(requirement),
        )

        assert isinstance(outcome, CreatePersonaResponse)
        assert outcome.agent_version == 1
        assert uuid.UUID(outcome.agent_id.removeprefix("agt_")).version == 7
        assert embedding_client.calls == [
            (TENANT_A, "analysis.reasoning\ndocument.synthesis")
        ]

        result = await db_session.execute(
            text(
                """
SELECT
  a.tenant_id::text AS agent_tenant_id,
  a.workspace_id::text AS workspace_id,
  a.name,
  a.tier,
  a.status,
  a.persona_description,
  av.id AS version_id,
  av.tenant_id::text AS version_tenant_id,
  av.version_number,
  av.config,
  av.published_at IS NOT NULL AS is_published,
  ce.id AS embedding_id,
  ce.tenant_id::text AS embedding_tenant_id,
  ce.capability_description,
  ce.embedding_metadata,
  1.0 - (ce.embedding <=> CAST(:expected_embedding AS vector(512))) AS similarity
FROM agents AS a
JOIN agent_versions AS av
  ON av.tenant_id = a.tenant_id AND av.agent_id = a.id
JOIN capability_embeddings AS ce
  ON ce.tenant_id = a.tenant_id AND ce.agent_id = a.id
WHERE a.id = :agent_id
"""
            ),
            {
                "agent_id": outcome.agent_id,
                "expected_embedding": _vector_literal(vector(1.0)),
            },
        )
        row = result.mappings().one()
        persona = json.loads(outcome.persona_json)

        assert row["agent_tenant_id"] == TENANT_A.removeprefix("ten_")
        assert row["version_tenant_id"] == TENANT_A.removeprefix("ten_")
        assert row["embedding_tenant_id"] == TENANT_A.removeprefix("ten_")
        assert row["workspace_id"] == WORKSPACE_A.removeprefix("ws_")
        assert row["name"] == "Capability agent: analysis.reasoning"
        assert row["tier"] == "STANDARD"
        assert row["status"] == "active"
        assert row["persona_description"] == (
            "Specialist agent for capabilities: "
            "analysis.reasoning, document.synthesis."
        )
        assert uuid.UUID(str(row["version_id"]).removeprefix("agtv_")).version == 7
        assert uuid.UUID(str(row["embedding_id"]).removeprefix("cemb_")).version == 7
        assert row["version_number"] == 1
        assert row["is_published"] is True
        assert row["config"] == persona
        assert row["capability_description"] == row["persona_description"]
        assert row["embedding_metadata"] == {"dimensions": 512, "source": "PLAN-8"}
        assert float(row["similarity"]) == pytest.approx(1.0)
        assert persona == {
            "capability_profile": requirement.model_dump(exclude_none=True),
            "persona_description": row["persona_description"],
            "tier": "STANDARD",
        }

    async def test_created_persona_is_immediately_bindable_by_plan7(
        self,
        db_session: AsyncSession,
    ) -> None:
        requirement = NodeRequirement(
            capabilities=["analysis.reasoning", "document.synthesis"],
            model_alias="STANDARD",
            tools=[ToolRequirement(name="search.web", permissions=["web:read"])],
        )
        embedding_client = FakeEmbeddingClient(vector(1.0))
        creation_engine = AgentAutoCreationEngine(db_session, embedding_client)
        created = await creation_engine.create_for_no_match(
            true_no_match(),
            create_request(requirement),
        )
        assert isinstance(created, CreatePersonaResponse)

        binding_engine = SelectionBindingEngine(db_session, embedding_client)
        bound = await binding_engine.bind(
            binding_request(requirement),
            binding_context(),
        )

        assert bound == BindAgentModelToolResponse(
            agent_id=created.agent_id,
            agent_version=1,
            model_alias="STANDARD",
            tool_names=["search.web"],
        )
        assert embedding_client.calls == [
            (TENANT_A, "analysis.reasoning\ndocument.synthesis"),
            (TENANT_A, "analysis.reasoning\ndocument.synthesis"),
        ]

    async def test_created_agent_cannot_bind_for_another_tenant(
        self,
        db_session: AsyncSession,
    ) -> None:
        requirement = NodeRequirement(capabilities=["analysis.reasoning"])
        embedding_client = FakeEmbeddingClient(vector(1.0))
        creation_engine = AgentAutoCreationEngine(db_session, embedding_client)
        created = await creation_engine.create_for_no_match(
            true_no_match(),
            create_request(requirement),
        )
        assert isinstance(created, CreatePersonaResponse)

        binding_engine = SelectionBindingEngine(db_session, embedding_client)
        cross_tenant = await binding_engine.bind(
            binding_request(requirement, tenant_id=TENANT_B),
            binding_context(),
        )

        assert cross_tenant == NoAgentMatch(
            node_key="node.one",
            reason="no_eligible_agent",
        )

    @pytest.mark.parametrize(
        "requirement",
        [
            NodeRequirement(capabilities=[]),
            NodeRequirement(
                capabilities=["analysis.reasoning"],
                preferred_agent_id=(
                    "agt_018f47a5-7b2c-7d10-8f11-123456789abc"
                ),
            ),
        ],
    )
    async def test_inconsistent_no_match_profile_fails_without_writes(
        self,
        db_session: AsyncSession,
        requirement: NodeRequirement,
    ) -> None:
        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = AgentAutoCreationEngine(db_session, embedding_client)

        with pytest.raises(PersonaCreationValidationError):
            await engine.create_for_no_match(
                true_no_match(),
                create_request(requirement),
            )

        assert embedding_client.calls == []
        assert await table_counts(db_session) == (0, 0, 0)

    async def test_invalid_capability_profile_fails_without_writes(
        self,
        db_session: AsyncSession,
    ) -> None:
        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = AgentAutoCreationEngine(db_session, embedding_client)
        request = CreatePersonaRequest(
            tenant_id=TENANT_A,
            workspace_id=WORKSPACE_A,
            capability_profile_json="not-json",
        )

        with pytest.raises(PersonaCreationValidationError, match="NodeRequirement"):
            await engine.create_for_no_match(true_no_match(), request)

        assert embedding_client.calls == []
        assert await table_counts(db_session) == (0, 0, 0)

    async def test_invalid_embedding_fails_before_database_writes(
        self,
        db_session: AsyncSession,
    ) -> None:
        engine = AgentAutoCreationEngine(db_session, FakeEmbeddingClient([1.0]))

        with pytest.raises(EmbeddingResultError):
            await engine.create_for_no_match(
                true_no_match(),
                create_request(NodeRequirement(capabilities=["analysis.reasoning"])),
            )

        assert await table_counts(db_session) == (0, 0, 0)


def _vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in values) + "]"
