#!/usr/bin/env sh
set -eu

# ADS deletion operates across tenant partitions for retention workflows. Its
# distinct local role mirrors the dedicated production connection.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=ads_deletion_password="$ADS_DELETION_DB_PASSWORD" <<'SQL'
CREATE ROLE ads_deletion LOGIN PASSWORD :'ads_deletion_password' BYPASSRLS;
GRANT CONNECT ON DATABASE ads_db TO ads_deletion;
GRANT USAGE ON SCHEMA public TO ads_deletion;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ads_deletion;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ads_deletion;
SQL
