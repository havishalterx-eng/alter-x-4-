"""Deterministic hardening harness and regression-case capture pipeline."""

import json
from dataclasses import dataclass
from hashlib import sha256
from typing import Protocol
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy.orm import Session, sessionmaker

from src.db.launch_golden_sets import EvalCaseSeed
from src.db.models import EvalCase


@dataclass(frozen=True)
class MockEvaluation:
    passed: bool
    observed_output: dict[str, object]
    failure_reason: str | None


class MockHarness:
    """Scores a supplied deterministic mock output; it never calls a model."""

    def evaluate(self, case: EvalCaseSeed, output: dict[str, object]) -> MockEvaluation:
        matcher = case.scoring["matcher"]
        if matcher == "exact_json":
            passed = output == case.expected_json
        elif matcher == "contains_document":
            document_key = case.expected_json["expected_document_key"]
            document_keys = output.get("document_keys")
            rank = output.get("rank")
            max_rank = case.scoring["rank_at_most"]
            passed = (
                isinstance(document_keys, list)
                and document_key in document_keys
                and isinstance(rank, int)
                and isinstance(max_rank, int)
                and rank <= max_rank
            )
        else:
            raise ValueError(f"Unsupported mock matcher: {matcher!r}")

        return MockEvaluation(
            passed=passed,
            observed_output=output,
            failure_reason=None if passed else f"{matcher}_mismatch",
        )


def passing_mock_output(case: EvalCaseSeed) -> dict[str, object]:
    """Returns a deterministic success fixture for any currently seeded case."""
    if case.scoring["matcher"] == "contains_document":
        document_key = case.expected_json["expected_document_key"]
        return {"document_keys": [document_key], "rank": 1}
    return dict(case.expected_json)


@dataclass(frozen=True)
class PersistedEvalCase:
    id: UUID
    golden_set_id: UUID
    input_json: dict[str, object]
    expected_json: dict[str, object]
    scoring: dict[str, object]
    tags: list[str]


@dataclass(frozen=True)
class RegressionCapture:
    regression_case_id: UUID
    created: bool


class RegressionCaseStore(Protocol):
    def get(self, case_id: UUID) -> PersistedEvalCase | None: ...

    def add(self, case: PersistedEvalCase) -> bool: ...


class InMemoryRegressionCaseStore:
    def __init__(self, cases: tuple[PersistedEvalCase, ...] = ()) -> None:
        self._cases = {case.id: case for case in cases}

    def get(self, case_id: UUID) -> PersistedEvalCase | None:
        return self._cases.get(case_id)

    def add(self, case: PersistedEvalCase) -> bool:
        if case.id in self._cases:
            return False
        self._cases[case.id] = case
        return True


class SqlAlchemyRegressionCaseStore:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def get(self, case_id: UUID) -> PersistedEvalCase | None:
        with self._sessions() as session:
            row = session.get(EvalCase, case_id)
            return _persisted_case(row) if row is not None else None

    def add(self, case: PersistedEvalCase) -> bool:
        with self._sessions.begin() as session:
            if session.get(EvalCase, case.id) is not None:
                return False
            session.add(
                EvalCase(
                    id=case.id,
                    golden_set_id=case.golden_set_id,
                    input_json=case.input_json,
                    expected_json=case.expected_json,
                    scoring=case.scoring,
                    tags=case.tags,
                )
            )
        return True


class RegressionCapturePipeline:
    def __init__(self, store: RegressionCaseStore) -> None:
        self._store = store

    def capture(self, source_case_id: UUID, evaluation: MockEvaluation) -> RegressionCapture | None:
        if evaluation.passed:
            return None
        source = self._store.get(source_case_id)
        if source is None:
            raise LookupError(f"Eval case {source_case_id} was not found")

        signature = _failure_signature(source.id, evaluation)
        regression_case_id = uuid5(
            NAMESPACE_URL, f"https://alterx.dev/eval/regression/{source.id}/{signature}"
        )
        scoring = dict(source.scoring)
        scoring["regression"] = {
            "source_case_id": str(source.id),
            "failure_signature": signature,
            "failure_reason": evaluation.failure_reason,
        }
        tags = list(dict.fromkeys([*source.tags, "regression", f"source:{source.id}"]))
        created = self._store.add(
            PersistedEvalCase(
                id=regression_case_id,
                golden_set_id=source.golden_set_id,
                input_json=dict(source.input_json),
                expected_json=dict(source.expected_json),
                scoring=scoring,
                tags=tags,
            )
        )
        return RegressionCapture(regression_case_id=regression_case_id, created=created)


def _persisted_case(row: EvalCase) -> PersistedEvalCase:
    return PersistedEvalCase(
        id=row.id,
        golden_set_id=row.golden_set_id,
        input_json=dict(row.input_json),
        expected_json=dict(row.expected_json),
        scoring=dict(row.scoring),
        tags=list(row.tags),
    )


def _failure_signature(source_case_id: UUID, evaluation: MockEvaluation) -> str:
    payload = {
        "source_case_id": str(source_case_id),
        "observed_output": evaluation.observed_output,
        "failure_reason": evaluation.failure_reason,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256(encoded).hexdigest()[:16]
