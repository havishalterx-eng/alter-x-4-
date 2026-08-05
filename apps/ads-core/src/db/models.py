from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Computed, DateTime, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class Scope(Base):
    __tablename__ = "scopes"
    __table_args__ = (UniqueConstraint("tenant_id", "id", name="scopes_tenant_id_id_unique"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    workspace_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Source(Base):
    __tablename__ = "sources"
    __table_args__ = (UniqueConstraint("tenant_id", "id", name="sources_tenant_id_id_unique"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    scope_id: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str | None] = mapped_column(Text)
    integration_ref: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    sync_config: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    permissions: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    status: Mapped[str | None] = mapped_column(Text)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("tenant_id", "id", name="documents_tenant_id_id_unique"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    scope_id: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(Text)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False)
    permissions: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    status: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DocumentVersion(Base):
    """Immutable. No tenant_id column -- inherited via document_id FK.

    See migration 0001's module docstring for why this table has no direct
    tenant_id/RLS-by-current_setting, unlike every other table here.
    """

    __tablename__ = "document_versions"

    document_id: Mapped[str] = mapped_column(Text, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    content_ref: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str | None] = mapped_column(Text)
    normalized_ref: Mapped[str | None] = mapped_column(Text)
    freshness_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provenance: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    ingestion_job_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Chunk(Base):
    __tablename__ = "chunks"
    __table_args__ = (UniqueConstraint("tenant_id", "id", name="chunks_tenant_id_id_unique"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    scope_id: Mapped[str] = mapped_column(Text, nullable=False)
    document_id: Mapped[str] = mapped_column(Text, nullable=False)
    document_version: Mapped[int] = mapped_column(Integer, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict[str, object] | None] = mapped_column("metadata", JSONB)
    embedding: Mapped[list[float]] = mapped_column(Vector(1024), nullable=False)
    embedding_provider: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_model: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_version: Mapped[str] = mapped_column(Text, nullable=False)
    distance_metric: Mapped[str] = mapped_column(Text, nullable=False, server_default="cosine")
    # Generated column (STORED, defined in the migration's raw SQL).
    # `Computed(...)` here is a read-only marker (the real formula lives in
    # the migration, not duplicated for DDL purposes) that tells SQLAlchemy
    # to exclude this column from INSERT/UPDATE -- Postgres rejects any
    # explicit value, even NULL, for a GENERATED ALWAYS column. Plain
    # `deferred=True` alone (KNOW-2's original mapping) does NOT achieve
    # this -- deferred only affects SELECT loading strategy, and the first
    # real chunk INSERT (KNOW-5) failed until this was added.
    text_search: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed("to_tsvector('english', text_content)"), deferred=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Record(Base):
    __tablename__ = "records"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="records_tenant_id_id_unique"),
        UniqueConstraint(
            "source_id",
            "entity_type",
            "external_key",
            "version",
            name="records_source_entity_key_version_unique",
        ),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    scope_id: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[str] = mapped_column(Text, nullable=False)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    external_key: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    freshness_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MemoryNamespace(Base):
    __tablename__ = "memory_namespace"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="memory_namespace_tenant_id_id_unique"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    scope_id: Mapped[str] = mapped_column(Text, nullable=False)
    project_ref: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Numeric)
    scope_inputs: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    filters: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    candidate_ids: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    ranking_summary: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    provenance: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IngestionJob(Base):
    __tablename__ = "ingestion_jobs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="ingestion_jobs_tenant_id_id_unique"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    source_id: Mapped[str] = mapped_column(Text, nullable=False)
    stage: Mapped[str] = mapped_column(Text, nullable=False)
    stats: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    error: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RetrievalAudit(Base):
    __tablename__ = "retrieval_audit"
    __table_args__ = (
        UniqueConstraint("tenant_id", "id", name="retrieval_audit_tenant_id_id_unique"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UUID(as_uuid=False), nullable=False)
    scope_id: Mapped[str | None] = mapped_column(Text)
    requester: Mapped[str] = mapped_column(Text, nullable=False)
    query_hash: Mapped[str | None] = mapped_column(Text)
    result_doc_ids: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    confidence: Mapped[float | None] = mapped_column(Numeric)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
