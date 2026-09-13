"""Real-Postgres coverage for PLAN-7 selection and binding."""

import json
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
from src.selection_binding.policy_client import RoutingWeights

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
    def __init__(
        self,
        weight: float | None,
        efficiency_weight: float | None = None,
        *,
        found: bool = True,
    ) -> None:
        self.weight = weight
        self.efficiency_weight = efficiency_weight
        self.found = found
        self.calls = 0

    async def routing_weights(self, tenant_id: str) -> RoutingWeights | None:
        assert tenant_id == TENANT_A
        self.calls += 1
        if not self.found:
            return None
        return RoutingWeights(
            similarity_weight=self.weight,
            efficiency_weight=self.efficiency_weight,
        )


class UnreachableRoutingPolicyClient:
    async def routing_weights(self, tenant_id: str) -> RoutingWeights | None:
        raise RuntimeError("policy store unreachable")


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
    # What the agent declares it can do. Every requirement in this suite asks
    # for one of these two, so the default keeps a seeded agent eligible; a
    # test proving the exact-capability filter excludes something overrides it
    # (#158). Before the filter existed this column was never read, and the
    # helper did not set it.
    capabilities: Sequence[str] = ("text.generation", "analysis.reasoning"),
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
            capabilities=capabilities,
        )
    for version_number in unpublished_versions:
        await seed_version(
            session,
            tenant_uuid=tenant_uuid,
            agent_id=agent_id,
            version_number=version_number,
            published=False,
            capabilities=capabilities,
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
    capabilities: Sequence[str] = ("text.generation", "analysis.reasoning"),
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
        capabilities=capabilities,
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
    capabilities: Sequence[str] = (),
) -> None:
    await session.execute(
        text(
            """
INSERT INTO agent_versions
  (id, agent_id, tenant_id, version_number, published_at, capabilities)
VALUES
  (:id, :agent_id, CAST(:tenant_id AS uuid), :version_number,
   CASE WHEN :published THEN now() ELSE NULL END,
   CAST(:capabilities AS jsonb))
"""
        ),
        {
            "id": f"agtv-{agent_id}-{version_number}",
            "capabilities": json.dumps(list(capabilities), separators=(",", ":")),
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

    async def test_a_perfect_embedding_match_cannot_bind_an_undeclared_capability(
        self,
        db_session: AsyncSession,
    ) -> None:
        """The exact-capability filter, and the reason it exists (#158).

        The agent's embedding is the query vector itself, so capability
        similarity is 1.0 -- the highest score obtainable. It still must not
        bind, because it does not declare the capability being asked for.
        Before the filter, similarity alone decided eligibility and this agent
        would have won outright.
        """
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            embedding=vector(1.0),
            capabilities=["analysis.reasoning"],
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

    async def test_declaring_more_than_is_asked_for_still_binds(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Containment, not equality: the requirement must be a subset.

        An agent that can do more than the node needs is still a match. The
        opposite reading would make every extra capability an agent declares a
        reason to reject it.
        """
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            embedding=vector(1.0),
            capabilities=["text.generation", "analysis.reasoning", "code.review"],
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_every_requested_capability_must_be_declared(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Declaring one of two is not enough -- `@>` is set containment."""
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            embedding=vector(1.0),
            capabilities=["text.generation"],
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(
                NodeRequirement(capabilities=["text.generation", "code.review"]),
            ),
            context(),
        )

        assert outcome == NoAgentMatch(
            node_key="node.one",
            reason="no_eligible_agent",
        )

    async def test_the_capability_filter_reads_the_latest_published_version(
        self,
        db_session: AsyncSession,
    ) -> None:
        """The filter sits on the same LATERAL the tier and version come from.

        An agent that used to declare the capability and no longer does must
        stop matching, so the newest published version is what counts.
        """
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            embedding=vector(1.0),
            published_versions=(1,),
            capabilities=["text.generation"],
        )
        await seed_version(
            db_session,
            tenant_uuid=raw_id(TENANT_A),
            agent_id=AGENT_A,
            version_number=2,
            published=True,
            capabilities=["analysis.reasoning"],
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

    async def test_declared_capability_binds_even_on_a_useless_embedding(
        self,
        db_session: AsyncSession,
    ) -> None:
        """A stale embedding is a ranking problem, not an eligibility one.

        This agent's stored vector is orthogonal to the query -- similarity
        0.0, the worst obtainable -- and it still binds, because it published
        the capability that was asked for. The score floors that used to
        reject it were measured to be unreachable (minimum_capability_
        similarity) and wrong (minimum_combined_score, which rejected agents
        declaring every requested capability once a requirement carried more
        than three of them); see the ranked query's own note.

        Nothing else can bind here: an agent that has not declared the
        capability is excluded by containment before any score is computed,
        which is the test directly above this one.
        """
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

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_a_many_capability_requirement_binds_the_agent_declaring_all(
        self,
        db_session: AsyncSession,
    ) -> None:
        """The case the old combined_score floor got wrong.

        A requirement embeds the join of its capabilities; an agent stores one
        embedding row per capability. The more capabilities a requirement
        carries, the less the joined query resembles any single row --
        measured against real Titan embeddings at 0.51 for four. The agent
        here declares every one of them and sits at similarity 0.5, which
        `minimum_combined_score = 0.7` rejected at any performance_score, so
        the request fell through to auto-creation and minted a duplicate on
        every attempt.
        """
        capabilities = [
            "text.generation",
            "analysis.reasoning",
            "text.summarisation",
            "text.translation",
        ]
        await seed_agent(
            db_session,
            agent_id=AGENT_A,
            # cos = 1 / 2 against the query below: a legitimate declaring
            # agent, scoring far under the floor that used to be here.
            embedding=vector(1.0, 3.0**0.5),
            capabilities=capabilities,
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=capabilities)),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_a_declaring_agent_outranks_one_with_a_stale_embedding(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Both declare it; the one whose embedding agrees is preferred."""
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(0.0, 1.0))
        await seed_agent(db_session, agent_id=AGENT_B, embedding=vector(1.0))
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["analysis.reasoning"])),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_B

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

    async def test_an_agent_with_no_history_does_not_beat_a_measured_cheap_one(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Never having run is not evidence of being cheap.

        An unmeasured agent scores the neutral 0.5 on efficiency, the same
        default performance_score already uses. If absence scored as free, a
        brand-new agent would outrank every agent that has ever done any work.
        """
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        await seed_agent(db_session, agent_id=AGENT_B, embedding=vector(1.0))
        # AGENT_A: measured, and very cheap. AGENT_B: no records at all.
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["success", "success"],
            latency_ms=50,
            token_count=40,
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_efficiency_never_outweighs_a_clearly_better_match(
        self,
        db_session: AsyncSession,
    ) -> None:
        """The weight is deliberately small.

        A cheap agent should win between comparable candidates, not beat one
        that matches the requirement far better. AGENT_B is as cheap as the
        fixture gets and still loses to a materially closer embedding.
        """
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        await seed_agent(db_session, agent_id=AGENT_B, embedding=vector(0.55, 0.835))
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["success", "success"],
            latency_ms=9_000,
            token_count=9_000,
        )
        await seed_performance(
            db_session,
            agent_id=AGENT_B,
            verdicts=["success", "success"],
            latency_ms=10,
            token_count=10,
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_efficiency_does_not_decide_eligibility(
        self,
        db_session: AsyncSession,
    ) -> None:
        """The floor stays on combined_score alone.

        A very slow, very expensive agent is still eligible if it matches --
        being slow is a reason to prefer somebody else, not a reason to be
        unbindable when there is nobody else.
        """
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["success", "success"],
            latency_ms=120_000,
            token_count=500_000,
        )
        engine = SelectionBindingEngine(db_session, FakeEmbeddingClient(vector(1.0)))

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])),
            context(),
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_recorded_latency_and_cost_move_the_routing_decision(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Batch 5 probe (rebuild plan, "Selection & Binding cost-and-latency
        -ignored"), now asserting the fixed behaviour.

        It used to assert the defect, and was accurate: combined_score was
        similarity and verdicts only, so two agents tying on both were ordered
        by `agent_id ASC` and a ~30x gap in recorded latency and tokens could
        not move the winner. performance_records has carried latency_ms and
        token_count all along -- seed-local.sh seeds exactly this pair to make
        it observable -- and the query simply never selected either column.

        The swap is what makes this test worth having. AGENT_A sorts first, so
        the first bind alone proves nothing; after the costs are exchanged the
        winner has to become AGENT_B, which is precisely what `agent_id ASC`
        would not do.
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

        # Exchange which agent is cheap and fast. Similarity and verdicts are
        # unchanged and identical, so combined_score still ties; only the
        # efficiency term differs, and the winner must follow it.
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

        cheap_agent_wins_again = await engine.bind(request, context())
        assert isinstance(cheap_agent_wins_again, BindAgentModelToolResponse)
        assert cheap_agent_wins_again.agent_id == AGENT_B

    async def test_active_policy_efficiency_weight_changes_the_next_selection(
        self,
        db_session: AsyncSession,
    ) -> None:
        """The tenant decides how much cost is allowed to matter (#159).

        Two agents tie on similarity and verdicts, so only the efficiency term
        separates them, and the slower one sorts first by id. At an efficiency
        weight of zero the term cannot break the tie and the id decides; raise
        it and the cheap agent wins. The weight is the only thing that changes
        between the two binds.
        """
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        await seed_agent(db_session, agent_id=AGENT_B, embedding=vector(1.0))
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["success", "success"],
            latency_ms=9_000,
            token_count=5_000,
        )
        await seed_performance(
            db_session,
            agent_id=AGENT_B,
            verdicts=["success", "success"],
            latency_ms=150,
            token_count=120,
        )
        policy = MutableRoutingPolicyClient(0.8, efficiency_weight=0.0)
        engine = SelectionBindingEngine(
            db_session,
            FakeEmbeddingClient(vector(1.0)),
            policy_client=policy,
        )
        request = request_for(NodeRequirement(capabilities=["text.generation"]))

        cost_ignored = await engine.bind(request, context())
        policy.efficiency_weight = 0.9
        cost_decisive = await engine.bind(request, context())

        assert isinstance(cost_ignored, BindAgentModelToolResponse)
        assert isinstance(cost_decisive, BindAgentModelToolResponse)
        assert cost_ignored.agent_id == AGENT_A
        assert cost_decisive.agent_id == AGENT_B

    async def test_a_policy_setting_only_similarity_keeps_the_default_efficiency(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Policy bodies predate `efficiency_weight` and must keep working.

        Such a body sets `similarity_weight` alone. The unset weight falls
        back to the engine's own default rather than to zero, so the cheap
        agent still wins -- an older policy must not silently turn cost
        blindness back on.
        """
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        await seed_agent(db_session, agent_id=AGENT_B, embedding=vector(1.0))
        await seed_performance(
            db_session,
            agent_id=AGENT_A,
            verdicts=["success", "success"],
            latency_ms=9_000,
            token_count=5_000,
        )
        await seed_performance(
            db_session,
            agent_id=AGENT_B,
            verdicts=["success", "success"],
            latency_ms=150,
            token_count=120,
        )
        policy = MutableRoutingPolicyClient(0.8, efficiency_weight=None)
        engine = SelectionBindingEngine(
            db_session,
            FakeEmbeddingClient(vector(1.0)),
            policy_client=policy,
        )

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])), context()
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_B

    async def test_an_unreachable_policy_store_still_binds_on_the_defaults(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Routing on the configured defaults beats refusing to route."""
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        await seed_performance(db_session, agent_id=AGENT_A, verdicts=["success"])
        engine = SelectionBindingEngine(
            db_session,
            FakeEmbeddingClient(vector(1.0)),
            policy_client=UnreachableRoutingPolicyClient(),
        )

        outcome = await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])), context()
        )

        assert isinstance(outcome, BindAgentModelToolResponse)
        assert outcome.agent_id == AGENT_A

    async def test_one_policy_read_serves_both_weights(
        self,
        db_session: AsyncSession,
    ) -> None:
        """Both weights come out of one document, so one request reads them.

        Asking per weight would put a second HTTP round trip on the per-node
        binding path for a field of a body already in hand.
        """
        await seed_agent(db_session, agent_id=AGENT_A, embedding=vector(1.0))
        policy = MutableRoutingPolicyClient(0.8, efficiency_weight=0.25)
        engine = SelectionBindingEngine(
            db_session,
            FakeEmbeddingClient(vector(1.0)),
            policy_client=policy,
        )

        await engine.bind(
            request_for(NodeRequirement(capabilities=["text.generation"])), context()
        )

        assert policy.calls == 1
