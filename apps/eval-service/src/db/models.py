from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class GoldenSet(Base):
    __tablename__ = "golden_sets"
    __table_args__ = (UniqueConstraint("name", "domain", "version"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    domain: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    cases: Mapped[list["EvalCase"]] = relationship(back_populates="golden_set")


class EvalCase(Base):
    __tablename__ = "eval_cases"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    golden_set_id: Mapped[UUID] = mapped_column(ForeignKey("golden_sets.id"), nullable=False)
    input_json: Mapped[dict[str, object]] = mapped_column("input", JSONB, nullable=False)
    expected_json: Mapped[dict[str, object]] = mapped_column("expected", JSONB, nullable=False)
    scoring: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    golden_set: Mapped[GoldenSet] = relationship(back_populates="cases")


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    golden_set_id: Mapped[UUID] = mapped_column(ForeignKey("golden_sets.id"), nullable=False)
    golden_set_version: Mapped[int] = mapped_column(Integer, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    trigger: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    pass_rate: Mapped[float | None] = mapped_column(Numeric)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    results: Mapped[list["EvalResult"]] = relationship(back_populates="eval_run")


class EvalResult(Base):
    __tablename__ = "eval_results"
    __table_args__ = (UniqueConstraint("eval_run_id", "eval_case_id"),)

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    eval_run_id: Mapped[UUID] = mapped_column(ForeignKey("eval_runs.id"), nullable=False)
    eval_case_id: Mapped[UUID] = mapped_column(ForeignKey("eval_cases.id"), nullable=False)
    verdict: Mapped[str] = mapped_column(Text, nullable=False)
    score: Mapped[float | None] = mapped_column(Numeric)
    output_ref: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    eval_run: Mapped[EvalRun] = relationship(back_populates="results")


class RedteamResult(Base):
    __tablename__ = "redteam_results"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    suite: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[str] = mapped_column(Text, nullable=False)
    attack_ref: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ReleaseGate(Base):
    __tablename__ = "release_gates"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    eval_run_id: Mapped[UUID | None] = mapped_column(ForeignKey("eval_runs.id"))
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    decided_by: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
