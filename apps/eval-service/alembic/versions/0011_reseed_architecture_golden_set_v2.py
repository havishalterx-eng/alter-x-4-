"""Retire architecture golden set v1 and seed v2 in its place.

G3 now places human approval only before actions that may have side effects
(see src/db/architecture_golden_set.py). v2 keeps every v1 case unchanged --
none names a capability, so none is affected -- and adds four cases for the
new condition. v1 is retired rather than deleted, because eval_results
reference its cases; runs read the active set by name, so they move to v2 on
upgrade and back to v1 on downgrade.
"""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op
from src.db.architecture_golden_set import ARCHITECTURE_GOLDEN_SET, ARCHITECTURE_GOLDEN_SET_V2
from src.db.launch_golden_sets import case_id

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _sql_literal(value: object) -> str:
    return json.dumps(value, sort_keys=True).replace("'", "''")


def _ddl(statement: str) -> Any:
    return sa.DDL(statement)  # type: ignore[no-untyped-call]


def upgrade() -> None:
    op.execute(sa.text("SELECT set_config('app.eval_internal', 'on', true)"))
    op.execute(
        _ddl(
            "UPDATE golden_sets SET status = 'retired' "
            f"WHERE id = '{ARCHITECTURE_GOLDEN_SET.id}'"
        )
    )

    golden_set = ARCHITECTURE_GOLDEN_SET_V2
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
    golden_set = ARCHITECTURE_GOLDEN_SET_V2
    case_id_sql = ",".join(
        repr(str(case_id(golden_set, position)))
        for position, _case in enumerate(golden_set.cases, start=1)
    )
    op.execute(_ddl(f"DELETE FROM eval_cases WHERE id IN ({case_id_sql})"))
    op.execute(_ddl(f"DELETE FROM golden_sets WHERE id = '{golden_set.id}'"))
    op.execute(
        _ddl(
            "UPDATE golden_sets SET status = 'active' "
            f"WHERE id = '{ARCHITECTURE_GOLDEN_SET.id}'"
        )
    )
