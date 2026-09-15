"""Seed architecture golden set v1.

The fixed target for the Phase 4 Architecture Synthesizer rewrite, seeded
before the rewrite exists -- see src/db/architecture_golden_set.py for the
rules every expectation follows.
"""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op
from src.db.architecture_golden_set import ARCHITECTURE_GOLDEN_SET
from src.db.launch_golden_sets import case_id

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _sql_literal(value: object) -> str:
    return json.dumps(value, sort_keys=True).replace("'", "''")


def _ddl(statement: str) -> Any:
    return sa.DDL(statement)  # type: ignore[no-untyped-call]


def upgrade() -> None:
    op.execute(sa.text("SELECT set_config('app.eval_internal', 'on', true)"))
    golden_set = ARCHITECTURE_GOLDEN_SET
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
    op.execute(sa.text("SELECT set_config('app.eval_internal', 'on', true)"))
    golden_set = ARCHITECTURE_GOLDEN_SET
    op.execute(_ddl(f"DELETE FROM eval_cases WHERE golden_set_id = '{golden_set.id}'"))
    op.execute(_ddl(f"DELETE FROM golden_sets WHERE id = '{golden_set.id}'"))
