#!/usr/bin/env bash
set -euo pipefail

test_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
module_directory="$(cd "$test_directory/.." && pwd)"
fake_state="$(mktemp -d "${TMPDIR:-/tmp}/alterx-database-acl.XXXXXX")"
trap 'rm -rf "$fake_state"' EXIT

database_catalog=(
  "platform_db:platform_api"
  "orchestration_db:orchestration_service"
  "intelligence_db:intelligence_service"
  "policy_db:memory_policy_service"
  "cost_db:cost_ledger_service"
  "eval_db:eval_service"
  "audit_db:audit_service"
)

for database_entry in "${database_catalog[@]}"; do
  database_name="${database_entry%%:*}"
  database_user="${database_entry#*:}"

  PATH="$test_directory/fixtures:/usr/bin:/bin" \
    FAKE_RDS_STATE_DIR="$fake_state" \
    AWS_REGION="ap-south-1" \
    CLUSTER_ARN="arn:aws:rds:ap-south-1:000000000000:cluster:alter-test" \
    ADMIN_SECRET_ARN="arn:aws:secretsmanager:ap-south-1:000000000000:secret:alter-test" \
    DATABASE_NAME="$database_name" \
    DATABASE_USER="$database_user" \
    "$module_directory/scripts/bootstrap-logical-database.sh"
done

attempt_data_api_connection() {
  local database_user="$1"
  local database_name="$2"

  PATH="$test_directory/fixtures:/usr/bin:/bin" \
    FAKE_RDS_STATE_DIR="$fake_state" \
    FAKE_RDS_CALLER_ROLE="$database_user" \
    aws rds-data execute-statement \
    --region "ap-south-1" \
    --resource-arn "arn:aws:rds:ap-south-1:000000000000:cluster:alter-test" \
    --secret-arn "arn:aws:secretsmanager:ap-south-1:000000000000:secret:alter-test" \
    --database "$database_name" \
    --sql "SELECT 1" \
    >/dev/null 2>&1
}

for connection_attempt in "$fake_state/connection-attempts/"*; do
  if [[ "$(<"$connection_attempt")" != "rds_admin|postgres" ]]; then
    printf 'Bootstrap administration did not use the stable postgres database: %s.\n' \
      "$(<"$connection_attempt")" >&2
    exit 1
  fi
done

admin_target_rejections=0
for database_entry in "${database_catalog[@]}"; do
  database_name="${database_entry%%:*}"

  if attempt_data_api_connection "rds_admin" "$database_name"; then
    printf 'RDS admin unexpectedly retained CONNECT on %s after ACL lockdown.\n' "$database_name" >&2
    exit 1
  fi
  admin_target_rejections=$((admin_target_rejections + 1))
done

owner_connections=0
rejected_cross_connections=0
connection_attempts_before="$(find "$fake_state/connection-attempts" -type f | wc -l | tr -d ' ')"

for database_entry in "${database_catalog[@]}"; do
  database_name="${database_entry%%:*}"
  database_owner="${database_entry#*:}"

  if [[ "$(<"$fake_state/owners/$database_name")" != "$database_owner" ]]; then
    printf '%s does not have the expected owner %s.\n' "$database_name" "$database_owner" >&2
    exit 1
  fi

  if [[ ! -f "$fake_state/public-revoked/$database_name" ]]; then
    printf 'PUBLIC CONNECT and TEMPORARY were not revoked from %s.\n' "$database_name" >&2
    exit 1
  fi

  if [[ ! -f "$fake_state/connect-grants/${database_name}__${database_owner}" ]]; then
    printf 'CONNECT was not explicitly granted to %s on %s.\n' "$database_owner" "$database_name" >&2
    exit 1
  fi

  for role_entry in "${database_catalog[@]}"; do
    database_user="${role_entry#*:}"

    if [[ "$database_user" == "$database_owner" ]]; then
      if ! attempt_data_api_connection "$database_user" "$database_name"; then
        printf 'Owning role %s cannot connect to %s.\n' "$database_user" "$database_name" >&2
        exit 1
      fi
      owner_connections=$((owner_connections + 1))
    else
      if attempt_data_api_connection "$database_user" "$database_name"; then
        printf 'Cross-service role %s can connect to %s.\n' "$database_user" "$database_name" >&2
        exit 1
      fi
      rejected_cross_connections=$((rejected_cross_connections + 1))
    fi
  done
done

connection_attempts_after="$(find "$fake_state/connection-attempts" -type f | wc -l | tr -d ' ')"
if [[ $((connection_attempts_after - connection_attempts_before)) -ne 49 ]]; then
  printf 'Expected 49 separate Data API connection attempts for the ACL matrix.\n' >&2
  exit 1
fi

if [[ "$admin_target_rejections" -ne 7 || "$owner_connections" -ne 7 || "$rejected_cross_connections" -ne 42 ]]; then
  printf 'Expected 7 rejected admin connections, 7 owner connections, and 42 rejected cross-service connections; observed %s, %s, and %s.\n' \
    "$admin_target_rejections" "$owner_connections" "$rejected_cross_connections" >&2
  exit 1
fi

printf 'Database ACL isolation verified across separate Data API calls: 7 admin target connections and 42 cross-service connections rejected; 7 owner connections allowed.\n'
