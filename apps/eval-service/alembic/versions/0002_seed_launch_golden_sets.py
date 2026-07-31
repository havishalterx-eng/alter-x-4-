"""Seed the four version-1 hardening launch-floor golden sets."""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op
from src.db.launch_golden_sets import LAUNCH_GOLDEN_SETS, case_id

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def _sql_literal(value: object) -> str:
    return json.dumps(value, sort_keys=True).replace("'", "''")


def _ddl(statement: str) -> Any:
    # SQLAlchemy does not type DDL even though Alembic accepts it as an operation.
    return sa.DDL(statement)  # type: ignore[no-untyped-call]


def upgrade() -> None:
    # HARD-1's RLS policy is intentionally default-deny. Production migrations
    # execute as eval_service, so the explicit service context is required for
    # this data migration as well.
    op.execute(sa.text("SELECT set_config('app.eval_internal', 'on', true)"))
    for golden_set in LAUNCH_GOLDEN_SETS:
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
        for golden_set in LAUNCH_GOLDEN_SETS
        for position, _case in enumerate(golden_set.cases, start=1)
    ]
    golden_set_ids = [golden_set.id for golden_set in LAUNCH_GOLDEN_SETS]
    case_id_sql = ",".join(repr(str(value)) for value in case_ids)
    golden_set_id_sql = ",".join(repr(str(value)) for value in golden_set_ids)
    op.execute(_ddl(f"DELETE FROM eval_cases WHERE id IN ({case_id_sql})"))
    op.execute(_ddl(f"DELETE FROM golden_sets WHERE id IN ({golden_set_id_sql})"))
