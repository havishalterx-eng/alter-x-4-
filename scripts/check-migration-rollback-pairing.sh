#!/usr/bin/env bash
set -euo pipefail

# Wave 4 item 5. Every drizzle migration must have a paired rollback file
# (matching leading index number in drizzle/rollback/), and every alembic
# migration must define a real downgrade() body, not a stub -- so a
# migration can never ship without a real way back out.
#
# audit-service was the real gap this check would have caught
# automatically: it had real rollback SQL files on disk, but (unlike
# cost-ledger-service and orchestration-service) no migration-files.spec.ts
# asserting they existed or were complete -- a future migration could have
# shipped without one and nothing would have noticed.

failures=0

for drizzle_dir in apps/*/drizzle; do
  [ -d "$drizzle_dir" ] || continue
  rollback_dir="$drizzle_dir/rollback"
  if [ ! -d "$rollback_dir" ]; then
    echo "missing rollback directory: $rollback_dir" >&2
    failures=$((failures + 1))
    continue
  fi
  for migration in "$drizzle_dir"/*.sql; do
    [ -e "$migration" ] || continue
    index="$(basename "$migration" | cut -c1-4)"
    if ! compgen -G "$rollback_dir/${index}_"*".sql" > /dev/null; then
      echo "no rollback file for $migration (expected $rollback_dir/${index}_*.sql)" >&2
      failures=$((failures + 1))
    fi
  done
done

for versions_dir in apps/*/alembic/versions; do
  [ -d "$versions_dir" ] || continue
  for migration in "$versions_dir"/*.py; do
    [ -e "$migration" ] || continue
    if ! grep -q '^def downgrade' "$migration"; then
      echo "no downgrade() defined in $migration" >&2
      failures=$((failures + 1))
      continue
    fi
    # Real-body check: downgrade()'s function body (up to the next
    # top-level def) must contain at least one real statement, not just a
    # docstring + "pass"/"..." stub.
    body="$(awk '/^def downgrade/{flag=1; next} /^def [a-zA-Z_]+\(/{flag=0} flag' "$migration")"
    if ! printf '%s\n' "$body" | grep -qE '^[[:space:]]*(op\.|conn\.|connection\.|session\.|bind\.)'; then
      echo "downgrade() in $migration has no real statements (stub?)" >&2
      failures=$((failures + 1))
    fi
  done
done

if [ "$failures" -gt 0 ]; then
  echo "migration-rollback-pairing check failed: $failures problem(s) found" >&2
  exit 1
fi
echo "migration-rollback-pairing check ok"
