#!/usr/bin/env bash
set -euo pipefail

for required_name in AWS_REGION CLUSTER_ARN ADMIN_SECRET_ARN DATABASE_NAME DATABASE_USER; do
  if [[ -z "${!required_name:-}" ]]; then
    printf 'Missing required bootstrap input: %s\n' "$required_name" >&2
    exit 1
  fi
done

if ! command -v aws >/dev/null 2>&1; then
  printf 'AWS CLI is required to bootstrap Aurora logical databases.\n' >&2
  exit 1
fi

if [[ ! "$DATABASE_NAME" =~ ^[a-z][a-z0-9_]*$ ]] || [[ ! "$DATABASE_USER" =~ ^[a-z][a-z0-9_]*$ ]]; then
  printf 'Database and role names must be lowercase PostgreSQL identifiers.\n' >&2
  exit 1
fi

role_sql="DO \$alter\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${DATABASE_USER}') THEN EXECUTE 'CREATE ROLE ${DATABASE_USER} LOGIN'; END IF; END \$alter\$;"

aws rds-data execute-statement \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$ADMIN_SECRET_ARN" \
  --database postgres \
  --sql "$role_sql" \
  >/dev/null

aws rds-data execute-statement \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$ADMIN_SECRET_ARN" \
  --database postgres \
  --sql "GRANT rds_iam TO ${DATABASE_USER}" \
  >/dev/null

database_exists="$(aws rds-data execute-statement \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$ADMIN_SECRET_ARN" \
  --database postgres \
  --sql "SELECT 1 FROM pg_database WHERE datname = '${DATABASE_NAME}'" \
  --query 'records[0][0].longValue' \
  --output text)"

if [[ "$database_exists" != "1" ]]; then
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$ADMIN_SECRET_ARN" \
    --database postgres \
    --sql "CREATE DATABASE ${DATABASE_NAME} OWNER ${DATABASE_USER}" \
    >/dev/null
fi

aws rds-data execute-statement \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$ADMIN_SECRET_ARN" \
  --database postgres \
  --sql "ALTER DATABASE ${DATABASE_NAME} OWNER TO ${DATABASE_USER}" \
  >/dev/null

aws rds-data execute-statement \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$ADMIN_SECRET_ARN" \
  --database postgres \
  --sql "REVOKE CONNECT, TEMPORARY ON DATABASE ${DATABASE_NAME} FROM PUBLIC" \
  >/dev/null

aws rds-data execute-statement \
  --region "$AWS_REGION" \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$ADMIN_SECRET_ARN" \
  --database postgres \
  --sql "GRANT CONNECT ON DATABASE ${DATABASE_NAME} TO ${DATABASE_USER}" \
  >/dev/null
