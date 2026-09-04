"""Real-Postgres coverage for PLAN-7 selection and binding."""

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
from src.capability_resolver import NodeRequirement, NodeRequirements, ToolRequirement
from src.selection_binding import (
    BindAgentModelToolRequest,
    BindAgentModelToolResponse,
    BindingContext,
    BindingValidationError,
    EmbeddingResultError,
    NoAgentMatch,
    SelectionBindingEngine,
)

SERVICE_ROOT = Path(__file__).parent.parent
PGVECTOR_IMAGE = "pgvector/pgvector:pg16"

TENANT_A = "ten_018f47a5-7b2c-7d10-8f11-123456789abc"
TENANT_B = "ten_028f47a5-7b2c-7d10-8f11-123456789abc"
WORKSPACE_A = "ws_018f47a5-7b2c-7d10-8f11-123456789abc"
WORKSPACE_B = "ws_028f47a5-7b2c-7d10-8f11-123456789abc"
RUN_ID = "run_018f47a5-7b2c-7d10-8f11-123456789abc"

AGENT_A = "agt_018f47a5-7b2c-7d10-8f11-123456789ab1"
AGENT_B = "agt_018f47a5-7b2c-7d10-8f11-123456789ab2"
AGENT_C = "agt_018f47a5-7b2c-7d10-8f11-123456789ab3"
AGENT_GLOBAL = "agt_018f47a5-7b2c-7d10-8f11-123456789ab9"
PLATFORM_TENANT_ID = "ten_00000000-0000-7000-8000-000000000001"


class FakeEmbeddingClient:
    def __init__(self, vector: Sequence[float]) -> None:
        self.vector = vector
        self.calls: list[tuple[str, str]] = []

    async def embed(self, *, tenant_id: str, text: str) -> Sequence[float]:
        self.calls.append((tenant_id, text))
        return self.vector


class MutableRoutingPolicyClient:
    def __init__(self, weight: float | None) -> None:
        self.weight = weight

    async def similarity_weight(self, tenant_id: str) -> float | None:
        assert tenant_id == TENANT_A
        return self.weight


def vector(first: float, second: float = 0.0) -> list[float]:
    return [first, second, *([0.0] * 510)]


def raw_id(prefixed_id: str) -> str:
    return prefixed_id.split("_", maxsplit=1)[1]


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


def request_for(
    requirement: NodeRequirement,
    *,
    node_key: str = "node.one",
    tenant_id: str = TENANT_A,
) -> BindAgentModelToolRequest:
    requirements = NodeRequirements(root={node_key: requirement})
    return BindAgentModelToolRequest(
        tenant_id=tenant_id,
        run_id=RUN_ID,
        node_key=node_key,
        node_requirements_json=requirements.model_dump_json(exclude_none=True),
    )


def context(
    *,
    workspace_id: str = WORKSPACE_A,
    node_type: str = "LLMTask",
    task_category: str | None = "analysis",
) -> BindingContext:
    return BindingContext.model_validate(
        {
            "workspace_id": workspace_id,
            "node_type": node_type,
            "task_category": task_category,
        }
    )


async def seed_agent(
    session: AsyncSession,
    *,
    agent_id: str,
    tenant_id: str = TENANT_A,
    workspace_id: str = WORKSPACE_A,
    tier: str = "STANDARD",
    status: str = "active",
    embedding: Sequence[float] | None = None,
    published_versions: Sequence[int] = (1,),
    unpublished_versions: Sequence[int] = (),
) -> None:
    tenant_uuid = raw_id(tenant_id)
    await session.execute(
        text(
            """
INSERT INTO agents (id, tenant_id, workspace_id, name, tier, status)
VALUES (:agent_id, CAST(:tenant_id AS uuid), CAST(:workspace_id AS uuid), :name, :tier, :status)
"""
        ),
        {
            "agent_id": agent_id,
            "tenant_id": tenant_uuid,
            "workspace_id": raw_id(workspace_id),
            "name": f"Agent {agent_id[-1]}",
            "tier": tier,
            "status": status,
        },
    )

    for version_number in published_versions:
        await seed_version(
            session,
            tenant_uuid=tenant_uuid,
            agent_id=agent_id,
            version_number=version_number,
            published=True,
        )
    for version_number in unpublished_versions:
        await seed_version(
            session,
            tenant_uuid=tenant_uuid,
            agent_id=agent_id,
            version_number=version_number,
            published=False,
        )

    if embedding is not None:
        await session.execute(
            text(
                """
INSERT INTO capability_embeddings
  (id, agent_id, tenant_id, capability_description, embedding)
VALUES
  (:id, :agent_id, CAST(:tenant_id AS uuid), :description, CAST(:embedding AS vector(512)))
"""
            ),
            {
                "id": f"cemb-{agent_id}",
                "agent_id": agent_id,
                "tenant_id": tenant_uuid,
                "description": "text.generation analysis.reasoning",
                "embedding": vector_literal(embedding),
            },
        )


async def seed_global_agent(
    session: AsyncSession,
    *,
    agent_id: str = AGENT_GLOBAL,
    tier: str = "STANDARD",
    embedding: Sequence[float] | None = None,
) -> None:
    """A real global agent: tenant_id is the real PLATFORM_TENANT_ID
    sentinel (not NULL -- see 0005_global_agents' own module docstring for
    why), workspace_id is genuinely NULL (nothing FK-joins on it, so no
    sentinel is needed there)."""
    tenant_uuid = raw_id(PLATFORM_TENANT_ID)
    await session.execute(
        text(
            """
INSERT INTO agents (id, tenant_id, workspace_id, name, tier, status)
VALUES (:agent_id, CAST(:tenant_id AS uuid), NULL, :name, :tier, 'active')
"""
        ),
        {
            "agent_id": agent_id,
            "tenant_id": tenant_uuid,
            "name": f"Global agent {agent_id[-1]}",
            "tier": tier,
        },
    )
    await seed_version(
        session,
        tenant_uuid=tenant_uuid,
        agent_id=agent_id,
        version_number=1,
        published=True,
    )
    if embedding is not None:
        await session.execute(
            text(
                """
INSERT INTO capability_embeddings
  (id, agent_id, tenant_id, capability_description, embedding)
VALUES
  (:id, :agent_id, CAST(:tenant_id AS uuid), :description, CAST(:embedding AS vector(512)))
"""
            ),
            {
                "id": f"cemb-{agent_id}",
                "agent_id": agent_id,
                "tenant_id": tenant_uuid,
                "description": "text.generation analysis.reasoning",
                "embedding": vector_literal(embedding),
            },
        )


async def seed_version(
    session: AsyncSession,
    *,
    tenant_uuid: str,
    agent_id: str,
    version_number: int,
    published: bool,
) -> None:
    await session.execute(
        text(
            """
INSERT INTO agent_versions
  (id, agent_id, tenant_id, version_number, published_at)
VALUES
  (:id, :agent_id, CAST(:tenant_id AS uuid), :version_number,
   CASE WHEN :published THEN now() ELSE NULL END)
"""
        ),
        {
            "id": f"agtv-{agent_id}-{version_number}",
            "agent_id": agent_id,
            "tenant_id": tenant_uuid,
            "version_number": version_number,
            "published": published,
        },
    )


async def seed_performance(
    session: AsyncSession,
    *,
    agent_id: str,
    verdicts: Sequence[str],
    tenant_id: str = TENANT_A,
    node_type: str = "LLMTask",
    task_category: str = "analysis",
    id_suffix: str = "matching",
    latency_ms: int | None = None,
    token_count: int | None = None,
) -> None:
    for index, verdict in enumerate(verdicts):
        await session.execute(
            text(
                """
INSERT INTO performance_records
  (id, agent_id, tenant_id, node_type, task_category, verdict, latency_ms, token_count)
VALUES
  (:id, :agent_id, CAST(:tenant_id AS uuid), :node_type, :task_category, :verdict,
   :latency_ms, :token_count)
"""
            ),
            {
                "id": f"perf-{agent_id}-{id_suffix}-{index}",
                "agent_id": agent_id,
                "tenant_id": raw_id(tenant_id),
                "node_type": node_type,
                "task_category": task_category,
                "verdict": verdict,
                "latency_ms": latency_ms,
                "token_count": token_count,
            },
        )


def vector_literal(values: Sequence[float]) -> str:
    return "[" + ",".join(str(value) for value in values) + "]"


class TestBindingContractModels:
    def test_response_matches_locked_proto_fields(self) -> None:
        response = BindAgentModelToolResponse(
            agent_id=AGENT_A,
            agent_version=1,
            model_alias="STANDARD",
            tool_names=["search.web"],
        )
        assert response.model_dump() == {
            "agent_id": AGENT_A,
            "agent_version": 1,
            "model_alias": "STANDARD",
            "tool_names": ["search.web"],
        }

    def test_contract_models_reject_extra_fields_and_bad_uint32(self) -> None:
        with pytest.raises(ValidationError):
            BindAgentModelToolResponse.model_validate(
                {
                    "agent_id": AGENT_A,
                    "agent_version": -1,
                    "model_alias": "STANDARD",
                    "tool_names": [],
                }
            )
        with pytest.raises(ValidationError):
            BindAgentModelToolRequest.model_validate(
                {
                    **request_for(NodeRequirement(capabilities=[])).model_dump(),
                    "invented": True,
                }
            )


class TestSelectionBindingIntegration:
    async def test_active_routing_policy_changes_the_next_ranked_selection(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        await seed_agent(db_session, agent_id=AGENT_B, embedding=vector(0.98, 0.2))
        await seed_performance(db_session, agent_id=AGENT_A, verdicts=["failure", "failure"])
        await seed_performance(db_session, agent_id=AGENT_B, verdicts=["success", "success"])

        policy = MutableRoutingPolicyClient(0.0)
        engine = SelectionBindingEngine(
            db_session,
            FakeEmbeddingClient(vector(1.0)),
            policy_client=policy,
        )
        request = request_for(NodeRequirement(capabilities=["text.generation"]))

        first = await engine.bind(request, context())
        policy.weight = 1.0
        second = await engine.bind(request, context())

        assert isinstance(first, BindAgentModelToolResponse)
        assert isinstance(second, BindAgentModelToolResponse)
        assert first.agent_id == AGENT_B
        assert second.agent_id == AGENT_A

    async def test_similarity_and_matching_performance_jointly_rank_agents(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            embedding=vector(1.0),
            published_versions=(1,),
        )
        await seed_agent(
            db_session,
            agent_id=AGENT_B,
            embedding=vector(0.98, 0.2),
            published_versions=(1,),
            unpublished_versions=(2,),
        )
        await seed_agent(
            db_session,
            agent_id=AGENT_C,
            embedding=vector(1.0),
            status="deprecated",
        )
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["failure", "failure"],
        )
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["success", "success", "success", "success"],
            task_category="translation",
            id_suffix="irrelevant",
        )
        await seed_performance(
            db_session,
            agent_id=AGENT_B,
            verdicts=["success", "success"],
        )

        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = SelectionBindingEngine(db_session, embedding_client)
        requirement = NodeRequirement(
            capabilities=["text.generation", "analysis.reasoning"],
            model_alias="STANDARD",
            tools=[ToolRequirement(name="search.web", permissions=["web:read"])],
        )

        outcome = await engine.bind(request_for(requirement), context())

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_B
        assert outcome.agent_version == 1
        assert outcome.model_alias == "STANDARD"
        assert outcome.tool_names == ["search.web"]
        assert embedding_client.calls == [
            (TENANT_A, "text.generation\nanalysis.reasoning")
        ]

    async def test_required_tier_allows_higher_agent_but_never_downgrades(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            tier="STANDARD",
            embedding=vector(1.0),
        )
        await seed_agent(
            db_session,
            agent_id=AGENT_B,
            tier="CEILING",
            embedding=vector(0.98, 0.2),
            published_versions=(3,),
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(
                NodeRequirement(
                    capabilities=["analysis.reasoning"],
                    model_alias="ADVANCED",
                )
            ),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_B
        assert outcome.agent_version == 3
        assert outcome.model_alias == "ADVANCED"

    async def test_preferred_agent_binds_directly_to_latest_published_version(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            tier="CEILING",
            published_versions=(1, 2),
            unpublished_versions=(3,),
        )
        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = SelectionBindingEngine(db_session, embedding_client)

        outcome = await engine.bind(
            request_for(
                NodeRequirement(
                    capabilities=[],
                    preferred_agent_id=AGENT_A,
                )
            ),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A
        assert outcome.agent_version == 2
        assert outcome.model_alias == "CEILING"
        assert embedding_client.calls == []

    async def test_preferred_agent_below_required_tier_is_unavailable(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            tier="STANDARD",
        )
        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = SelectionBindingEngine(db_session, embedding_client)

        outcome = await engine.bind(
            request_for(
                NodeRequirement(
                    capabilities=["analysis.reasoning"],
                    model_alias="ADVANCED",
                    preferred_agent_id=AGENT_A,
                )
            ),
            context(),
        )

        assert outcome == NoAgentMatch(
            node_key="node.one",
            reason="preferred_agent_unavailable",
        )
        assert embedding_client.calls == []

    @pytest.mark.parametrize(
        ("tenant_id", "workspace_id", "status"),
        [
            (TENANT_B, WORKSPACE_A, "active"),
            (TENANT_A, WORKSPACE_B, "active"),
            (TENANT_A, WORKSPACE_A, "deprecated"),
        ],
    )
    async def test_untrusted_preferred_agent_returns_no_match_without_search(
        self,
        db_session: AsyncSession,
        tenant_id: str,
        workspace_id: str,
        status: str,
    ) -> None:
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            status=status,
            embedding=vector(1.0),
        )
        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = SelectionBindingEngine(db_session, embedding_client)

        outcome = await engine.bind(
            request_for(
                NodeRequirement(
                    capabilities=["text.generation"],
                    preferred_agent_id=AGENT_A,
                )
            ),
            context(),
        )

        assert outcome == NoAgentMatch(
            node_key="node.one",
            reason="preferred_agent_unavailable",
        )
        assert embedding_client.calls == []

    async def test_ranked_match_includes_a_draft_agent(
        self,
        db_session: AsyncSession,
    ) -> None:
        """A freshly auto-created agent starts 'draft' (agent_auto_creation.
        engine's _INSERT_AGENT) -- it must still be reachable here or it
        could never accumulate the real performance_records needed to be
        promoted to 'active'."""
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            status="draft",
            embedding=vector(1.0),
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_preferred_agent_binds_to_a_draft_agent(
        self,
        db_session: AsyncSession,
    ) -> None:
        """A caller that already knows an agent's real ID (e.g. a retry
        pinning the same agent) must still resolve it while it is 'draft'
        -- otherwise flipping auto-creation's default from 'active' to
        'draft' would silently regress this path."""
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            status="draft",
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(
                NodeRequirement(capabilities=[], preferred_agent_id=AGENT_A)
            ),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_cross_tenant_embedding_candidate_cannot_match(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            tenant_id=TENANT_B,
            embedding=vector(1.0),
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])),
            context(),
        )

        assert outcome == NoAgentMatch(
            node_key="node.one",
            reason="no_eligible_agent",
        )

    async def test_agent_without_published_version_cannot_match(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            embedding=vector(1.0),
            published_versions=(),
            unpublished_versions=(5,),
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])),
            context(),
        )

        assert outcome == NoAgentMatch(
            node_key="node.one",
            reason="no_eligible_agent",
        )

    async def test_eligible_agent_below_similarity_threshold_is_no_match(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            embedding=vector(0.0, 1.0),
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["analysis.reasoning"])),
            context(),
        )

        assert outcome == NoAgentMatch(
            node_key="node.one",
            reason="no_eligible_agent",
        )

    async def test_empty_capabilities_signal_agent_not_required_without_embedding(
        self,
        db_session: AsyncSession,
    ) -> None:
        embedding_client = FakeEmbeddingClient(vector(1.0))
        engine = SelectionBindingEngine(db_session, embedding_client)

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=[])),
            context(node_type="Gate", task_category=None),
        )

        assert outcome == NoAgentMatch(
            node_key="node.one",
            reason="agent_not_required",
        )
        assert embedding_client.calls == []

    @pytest.mark.parametrize(
        "invalid_embedding",
        [
            [1.0],
            [float("nan"), *([0.0] * 511)],
            [0.0] * 512,
        ],
    )
    async def test_invalid_injected_embedding_fails_loudly(
        self,
        db_session: AsyncSession,
        invalid_embedding: list[float],
    ) -> None:
        engine = SelectionBindingEngine(
            db_session,
            FakeEmbeddingClient(invalid_embedding),
        )

        with pytest.raises(EmbeddingResultError):
            await engine.bind(
                request_for(NodeRequirement(capabilities=["text.generation"])),
                context(),
            )

    async def test_missing_node_requirement_is_validation_error_not_no_match(
        self,
        db_session: AsyncSession,
    ) -> None:
        request = BindAgentModelToolRequest(
            tenant_id=TENANT_A,
            run_id=RUN_ID,
            node_key="missing",
            node_requirements_json=NodeRequirements(
                root={"other": NodeRequirement(capabilities=[])}
            ).model_dump_json(exclude_none=True),
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        with pytest.raises(BindingValidationError, match="no entry"):
            await engine.bind(request, context())

    async def test_ranked_match_finds_a_real_global_agent_from_an_unrelated_tenant(
        self,
        db_session: AsyncSession,
    ) -> None:
        """A real global agent (tenant_id=PLATFORM_TENANT_ID, workspace_id
        NULL) must be visible to a ranked-match search from a completely
        unrelated tenant/workspace -- the whole point of 0005_global_agents."""
        await seed_global_agent(db_session, embedding=vector(1.0))
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(
                NodeRequirement(capabilities=["text.generation"]),
                tenant_id=TENANT_B,
            ),
            context(workspace_id=WORKSPACE_B),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_GLOBAL

    async def test_preferred_agent_binds_to_a_real_global_agent(
        self,
        db_session: AsyncSession,
    ) -> None:
        await seed_global_agent(db_session)
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(
                NodeRequirement(capabilities=[], preferred_agent_id=AGENT_GLOBAL),
                tenant_id=TENANT_B,
            ),
            context(workspace_id=WORKSPACE_B),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_GLOBAL

    async def test_ranked_match_still_excludes_a_real_tenant_agent_from_a_different_tenant(
        self,
        db_session: AsyncSession,
    ) -> None:
        """The global-agent OR-bypass must not accidentally widen visibility
        for ordinary, real tenant-owned agents -- only rows whose real
        tenant_id is the platform sentinel become cross-tenant visible."""
        await seed_agent(db_session, agent_id=AGENT_A, tenant_id=TENANT_A, embedding=vector(1.0))
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(
                NodeRequirement(capabilities=["text.generation"]),
                tenant_id=TENANT_B,
            ),
            context(workspace_id=WORKSPACE_B),
        )

        assert outcome == NoAgentMatch(node_key="node.one", reason="no_eligible_agent")

    async def test_recorded_latency_and_cost_do_not_move_the_routing_decision(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Batch 5 probe (rebuild plan, "Selection & Binding cost-and-
        latency-ignored").

        _RANKED_AGENT_QUERY's combined_score is
        similarity_weight * capability_similarity + performance_weight *
        performance_score -- both purely similarity/verdict terms.
        performance_records.latency_ms and .token_count exist in the schema
        (the seed script that ships with this repo deliberately gives two
        fixture agents matching embeddings and verdicts but roughly an
        order-of-magnitude difference in latency_ms/token_count, exactly so
        this could be observed), but the query never selects either column.

        This test is written to fail if that diagnosis is wrong: two agents
        with identical capability similarity and identical verdict mix, but
        a ~30x difference in recorded latency and token cost, must produce
        the identical routing decision regardless of which one is actually
        cheap and fast -- because the tiebreak (agent_id ASC) is the only
        thing left once similarity and performance_score tie.
        """
        CHEAP_LATENCY_MS, CHEAP_TOKEN_COUNT = 200, 150
        SLOW_LATENCY_MS, SLOW_TOKEN_COUNT = 8_000, 4_200

        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        await seed_agent(db_session, agent_id=AGENT_B, embedding=vector(1.0))
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["success", "success"],
            latency_ms=CHEAP_LATENCY_MS,
            token_count=CHEAP_TOKEN_COUNT,
        )
        await seed_performance(
            db_session,
            agent_id=AGENT_B,
            verdicts=["success", "success"],
            latency_ms=SLOW_LATENCY_MS,
            token_count=SLOW_TOKEN_COUNT,
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))
        request = request_for(NodeRequirement(capabilities=["text.generation"]))

        cheap_agent_wins = await engine.bind(request, context())
        assert isinstance(cheap_agent_wins, BindAgentModelToolResponse)
        assert cheap_agent_wins.agent_id == AGENT_A

        # Swap which agent is actually cheap and fast. If cost or latency
        # influenced the ranking at all, the winner would flip too.
        await db_session.execute(text("DELETE FROM performance_records"))
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["success", "success"],
            latency_ms=SLOW_LATENCY_MS,
            token_count=SLOW_TOKEN_COUNT,
        )
        await seed_performance(
            db_session,
            agent_id=AGENT_B,
            verdicts=["success", "success"],
            latency_ms=CHEAP_LATENCY_MS,
            token_count=CHEAP_TOKEN_COUNT,
        )

        same_agent_wins_again = await engine.bind(request, context())
        assert isinstance(same_agent_wins_again, BindAgentModelToolResponse)
        assert same_agent_wins_again.agent_id == AGENT_A
