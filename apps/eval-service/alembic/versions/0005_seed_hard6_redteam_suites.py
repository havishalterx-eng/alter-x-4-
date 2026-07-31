"""Seed the two version-1 HARD-6 red-team suites."""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op
from src.db.launch_golden_sets import case_id
from src.db.redteam_suites import REDTEAM_GOLDEN_SETS

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_HARD6_REDTEAM_SETS = REDTEAM_GOLDEN_SETS[-2:]


def _sql_literal(value: object) -> str:
    return json.dumps(value, sort_keys=True).replace("'", "''")


def _ddl(statement: str) -> Any:
    return sa.DDL(statement)  # type: ignore[no-untyped-call]


def upgrade() -> None:
    op.execute(sa.text("SELECT set_config('app.eval_internal', 'on', true)"))
    for golden_set in _HARD6_REDTEAM_SETS:
        op.execute(
            _ddl(
                "INSERT INTO golden_sets(id, name, domain, version, status) VALUES "
                f"('{golden_set.id}', '{golden_set.name}', '{golden_set.domain}', "
                f"{golden_set.version}, 'active')"
            )
        )
        for position, case in enumerate(golden_set.cases, start=1):
            op.execute(
                _ddl(
                    "INSERT INTO eval_cases(id, golden_set_id, input, expected, scoring, tags) "
                    f"VALUES ('{case_id(golden_set, position)}', '{golden_set.id}', "
                    f"'{_sql_literal(case.input_json)}'::jsonb, "
                    f"'{_sql_literal(case.expected_json)}'::jsonb, "
                    f"'{_sql_literal(case.scoring)}'::jsonb, "
                    f"'{_sql_literal(case.tags)}'::jsonb)"
                )
            )


def downgrade() -> None:
    case_ids = [
        case_id(golden_set, position)
        for golden_set in _HARD6_REDTEAM_SETS
        for position, _case in enumerate(golden_set.cases, start=1)
    ]
    golden_set_ids = [golden_set.id for golden_set in _HARD6_REDTEAM_SETS]
    case_id_sql = ",".join(repr(str(value)) for value in case_ids)
    golden_set_id_sql = ",".join(repr(str(value)) for value in golden_set_ids)
    op.execute(_ddl(f"DELETE FROM eval_cases WHERE id IN ({case_id_sql})"))
    op.execute(_ddl(f"DELETE FROM golden_sets WHERE id IN ({golden_set_id_sql})"))
