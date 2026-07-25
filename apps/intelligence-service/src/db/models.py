from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="agents_tenant_id_id_unique"),
        CheckConstraint(
            "tier IN ('FAST', 'STANDARD', 'ADVANCED', 'CEILING')",
            name="agents_tier_check",
        ),
        CheckConstraint(
            "status IN ('draft', 'active', 'deprecated')",
            name="agents_status_check",
        ),
        Index("idx_agents_tenant_status", "tenant_id", "status"),
        Index("idx_agents_workspace", "workspace_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    workspace_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    tier: Mapped[str] = mapped_column(Text, nullable=False)
    persona_description: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=""
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="draft")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AgentVersion(Base):
    __tablename__ = "agent_versions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "id", name="agent_versions_tenant_id_id_unique"
        ),
        UniqueConstraint(
            "tenant_id",
            "agent_id",
            "version_number",
            name="agent_versions_agent_version_unique",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agents.tenant_id", "agents.id"],
            name="agent_versions_agent_tenant_fk",
        ),
        Index("idx_agent_versions_agent", "tenant_id", "agent_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    config: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class CapabilityEmbedding(Base):
    __tablename__ = "capability_embeddings"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "id",
            name="capability_embeddings_tenant_id_id_unique",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agents.tenant_id", "agents.id"],
            name="capability_embeddings_agent_tenant_fk",
        ),
        Index("idx_capability_embeddings_agent", "tenant_id", "agent_id"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    capability_description: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(512), nullable=False)
    embedding_metadata: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PerformanceRecord(Base):
    __tablename__ = "performance_records"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "id", name="performance_records_tenant_id_id_unique"
        ),
        ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agents.tenant_id", "agents.id"],
            name="performance_records_agent_tenant_fk",
        ),
        CheckConstraint(
            "verdict IN ('success', 'failure', 'partial', 'escalated')",
            name="performance_records_verdict_check",
        ),
        Index("idx_performance_records_agent_verdict", "agent_id", "verdict"),
        Index(
            "idx_performance_records_tenant_time",
            "tenant_id",
            "recorded_at",
        ),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    run_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    node_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_category: Mapped[str | None] = mapped_column(Text, nullable=True)
    verdict: Mapped[str] = mapped_column(Text, nullable=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
