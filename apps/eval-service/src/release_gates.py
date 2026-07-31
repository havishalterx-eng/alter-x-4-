"""Persistence for auditable release decisions derived from eval runs."""

from dataclasses import dataclass
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy.orm import Session, sessionmaker

from src.db.models import EvalRun, ReleaseGate


@dataclass(frozen=True)
class ReleaseGateRecord:
    id: UUID
    subject: str
    eval_run_id: UUID
    decision: str
    decided_by: str | None


class ReleaseGateRecorder:
    """Records a release decision only for a completed, scored eval run."""

    def __init__(
        self, sessions: sessionmaker[Session], minimum_pass_rate: Decimal = Decimal("1")
    ) -> None:
        if not Decimal("0") <= minimum_pass_rate <= Decimal("1"):
            raise ValueError("minimum_pass_rate must be between 0 and 1")
        self._sessions = sessions
        self._minimum_pass_rate = minimum_pass_rate

    def record(
        self, *, subject: str, eval_run_id: UUID, decided_by: str | None
    ) -> ReleaseGateRecord:
        with self._sessions.begin() as session:
            run = session.get(EvalRun, eval_run_id)
            if run is None:
                raise LookupError(f"Eval run {eval_run_id} was not found")
            if run.status != "completed" or run.pass_rate is None:
                raise ValueError("Release gates require a completed eval run with a pass rate")

            decision = (
                "approved" if Decimal(str(run.pass_rate)) >= self._minimum_pass_rate else "blocked"
            )
            record_id = uuid4()
            gate = ReleaseGate(
                id=record_id,
                subject=subject,
                eval_run_id=eval_run_id,
                decision=decision,
                decided_by=decided_by,
            )
            session.add(gate)

        return ReleaseGateRecord(
            id=record_id,
            subject=subject,
            eval_run_id=eval_run_id,
            decision=decision,
            decided_by=decided_by,
        )
