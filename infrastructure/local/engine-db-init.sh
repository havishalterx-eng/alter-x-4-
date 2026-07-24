#!/bin/sh
set -eu

: "${AUDIT_DB_PASSWORD:?AUDIT_DB_PASSWORD is required}"
: "${ORCHESTRATION_DB_PASSWORD:=$AUDIT_DB_PASSWORD}"

psql \
  --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname postgres \
  --set=audit_db_password="$AUDIT_DB_PASSWORD" \
  --set=orchestration_db_password="$ORCHESTRATION_DB_PASSWORD" <<'SQL'
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
SQL
