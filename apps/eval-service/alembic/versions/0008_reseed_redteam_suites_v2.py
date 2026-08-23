"""Retire the v1 red-team golden sets (domain="redteam", never dispatchable
-- see redteam_suites_v2.py's own module doc) and seed v2 in their place,
reshaped onto the real "injection"/"tenant-isolation" domains.
"""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op
from src.db.launch_golden_sets import case_id
from src.db.redteam_suites_v2 import REDTEAM_GOLDEN_SETS_V2, V1_GOLDEN_SET_IDS

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _sql_literal(value: object) -> str:
    return json.dumps(value, sort_keys=True).replace("'", "''")


def _ddl(statement: str) -> Any:
    return sa.DDL(statement)  # type: ignore[no-untyped-call]


def upgrade() -> None:
    op.execute(sa.text("SELECT set_config('app.eval_internal', 'on', true)"))

    v1_id_sql = ",".join(f"'{value}'" for value in V1_GOLDEN_SET_IDS)
    op.execute(_ddl(f"UPDATE golden_sets SET status = 'retired' WHERE id IN ({v1_id_sql})"))

    for golden_set in REDTEAM_GOLDEN_SETS_V2:
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
        for golden_set in REDTEAM_GOLDEN_SETS_V2
        for position, _case in enumerate(golden_set.cases, start=1)
    ]
    golden_set_ids = [golden_set.id for golden_set in REDTEAM_GOLDEN_SETS_V2]
    case_id_sql = ",".join(repr(str(value)) for value in case_ids)
    golden_set_id_sql = ",".join(repr(str(value)) for value in golden_set_ids)
    op.execute(_ddl(f"DELETE FROM eval_cases WHERE id IN ({case_id_sql})"))
    op.execute(_ddl(f"DELETE FROM golden_sets WHERE id IN ({golden_set_id_sql})"))

    v1_id_sql = ",".join(f"'{value}'" for value in V1_GOLDEN_SET_IDS)
    op.execute(_ddl(f"UPDATE golden_sets SET status = 'active' WHERE id IN ({v1_id_sql})"))
