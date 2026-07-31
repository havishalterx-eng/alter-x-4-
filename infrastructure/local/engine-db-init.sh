#!/bin/sh
set -eu

: "${AUDIT_DB_PASSWORD:?AUDIT_DB_PASSWORD is required}"
: "${ORCHESTRATION_DB_PASSWORD:=$AUDIT_DB_PASSWORD}"
: "${INTELLIGENCE_DB_PASSWORD:=$AUDIT_DB_PASSWORD}"
: "${COST_DB_PASSWORD:=$AUDIT_DB_PASSWORD}"

psql \
  --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set=audit_db_password="$AUDIT_DB_PASSWORD" \
  --set=orchestration_db_password="$ORCHESTRATION_DB_PASSWORD" \
  --set=intelligence_db_password="$INTELLIGENCE_DB_PASSWORD" \
  --set=cost_db_password="$COST_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE audit_service LOGIN PASSWORD %L',
  :'audit_db_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'audit_service'
) \gexec

ALTER ROLE audit_service WITH LOGIN PASSWORD :'audit_db_password';

SELECT 'CREATE DATABASE audit_db OWNER audit_service'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'audit_db'
) \gexec

ALTER DATABASE audit_db OWNER TO audit_service;
REVOKE CONNECT, TEMPORARY ON DATABASE audit_db FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE audit_db TO audit_service;

SELECT format(
  'CREATE ROLE orchestration_service LOGIN PASSWORD %L',
  :'orchestration_db_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'orchestration_service'
) \gexec

ALTER ROLE orchestration_service WITH LOGIN PASSWORD :'orchestration_db_password';

SELECT 'CREATE DATABASE orchestration_db OWNER orchestration_service'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'orchestration_db'
) \gexec

ALTER DATABASE orchestration_db OWNER TO orchestration_service;
REVOKE CONNECT, TEMPORARY ON DATABASE orchestration_db FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE orchestration_db TO orchestration_service;

SELECT format(
  'CREATE ROLE intelligence_service LOGIN PASSWORD %L',
  :'intelligence_db_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'intelligence_service'
) \gexec

ALTER ROLE intelligence_service WITH LOGIN PASSWORD :'intelligence_db_password';

SELECT 'CREATE DATABASE intelligence_db OWNER intelligence_service'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'intelligence_db'
) \gexec

ALTER DATABASE intelligence_db OWNER TO intelligence_service;
REVOKE CONNECT, TEMPORARY ON DATABASE intelligence_db FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE intelligence_db TO intelligence_service;

SELECT format(
  'CREATE ROLE cost_ledger_service LOGIN PASSWORD %L',
  :'cost_db_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'cost_ledger_service'
) \gexec

ALTER ROLE cost_ledger_service WITH LOGIN PASSWORD :'cost_db_password';

SELECT 'CREATE DATABASE cost_db OWNER cost_ledger_service'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'cost_db'
) \gexec

ALTER DATABASE cost_db OWNER TO cost_ledger_service;
REVOKE CONNECT, TEMPORARY ON DATABASE cost_db FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE cost_db TO cost_ledger_service;
SQL
