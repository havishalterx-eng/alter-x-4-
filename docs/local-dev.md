# Local development

Root Compose stack runs Engine dependencies without live AWS, Temporal Cloud,
Grafana Cloud, or Sentry accounts. `platform-db` remains Platform-owned and is
not used by Engine services.

## Prerequisites

- Docker Desktop with Compose v2
- Node.js and pnpm versions declared by repository

## Configure

```bash
cp .env.local.example .env.local
```

Replace every angle-bracket placeholder in `.env.local` with a local-only,
shell-safe value. Never commit `.env.local`.

## Start dependency stack

```bash
docker compose --env-file .env.local up -d --build --wait \
  engine-db ads-db cost-db redis localstack temporal otel
docker compose --env-file .env.local ps
```

Expected local endpoints:

- Engine PostgreSQL: `127.0.0.1:5433`, database `audit_db`, role
  `audit_service`
- ADS PostgreSQL: `127.0.0.1:5434`, database `ads_db`, role `ads_core`
- LocalStack edge: `http://127.0.0.1:4566`
- Temporal gRPC: `127.0.0.1:7233`
- Temporal Web UI: `http://127.0.0.1:8233`
- OTLP/gRPC: `127.0.0.1:4317`
- OTLP/HTTP: `http://127.0.0.1:4318`
- OTel collector health: `http://127.0.0.1:13133`

LocalStack ready hook creates `/alter/local/audit-service/system/database_credentials`
from local runtime values and creates `alter-local-cost-events` with its DLQ.
AWS SDK v3 reads `AWS_ENDPOINT_URL`, so all local AWS clients use LocalStack and
production adapter code needs no LocalStack-specific branch.

## Run ADS Core

ADS Core owns its dedicated `pgvector` cluster; apply its migrations before
starting the HTTP and gRPC processes:

```bash
export ADS_LOCAL_SERVICE_TOKEN="$(openssl rand -hex 32)"
export INTERNAL_SERVICE_TOKEN_SHA256="$(printf %s "$ADS_LOCAL_SERVICE_TOKEN" | shasum -a 256 | awk '{print $1}')"
uv run --project apps/ads-core alembic -c apps/ads-core/alembic.ini upgrade head
INTERNAL_SERVICE_TOKEN_SHA256="$INTERNAL_SERVICE_TOKEN_SHA256" \
  uv run --project apps/ads-core uvicorn src.main:app --app-dir apps/ads-core \
  --host 127.0.0.1 --port 8000
```

`MODEL_GATEWAY_GRPC_TARGET` must point at a running model gateway using a real
embedding provider before ingestion or retrieval can succeed. Do not replace it
with test-only embeddings for manual E2E checks.

## Run audit-service

Export local variables, build, and serve from host:

```bash
set -a
source .env.local
set +a
NODE_ENV=development pnpm nx run audit-service:serve
```

Startup runs Drizzle migrations against `audit_db`. In another terminal:

```bash
curl --fail --silent http://127.0.0.1:3000/health
# {"status":"ok","service":"audit-service"}
```

Verify migration and dedicated DB identity:

```bash
docker compose --env-file .env.local exec -T engine-db sh -c \
  'PGPASSWORD="$AUDIT_DB_PASSWORD" psql -U audit_service -d audit_db -Atc \
  "SELECT current_user, to_regclass('"'"'public.audit_events'"'"');"'
# audit_service|audit_events
```

## Run cost-ledger-service migrations

cost-ledger-service owns its own `cost-db` cluster, started above. Its first
migration creates the `cost_ledger_provisioner` role with `BYPASSRLS`, which
needs superuser or `CREATEROLE` -- `cost-db`'s `POSTGRES_USER` is that
superuser via the official image's initdb, same as `platform-db`/`ads-db`/
`engine-db`. Apply and verify migrations directly (full `serve` boot also
needs a LocalStack `database_credentials` secret for `cost-ledger-service`,
not yet seeded here -- future work, same as audit-service's app-level
observability wiring above):

```bash
docker compose --env-file .env.local exec -T cost-db sh -c \
  'PGPASSWORD="$COST_DB_PASSWORD" psql -U cost_ledger_service -d cost_db \
  -v ON_ERROR_STOP=1 -f - ' < apps/cost-ledger-service/drizzle/0001_create_billing_rollups.sql
docker compose --env-file .env.local exec -T cost-db sh -c \
  'PGPASSWORD="$COST_DB_PASSWORD" psql -U cost_ledger_service -d cost_db -Atc \
  "SELECT rolname FROM pg_roles WHERE rolname = '"'"'cost_ledger_provisioner'"'"';"'
# cost_ledger_provisioner
```

## Provider choices

- Secrets use real `AwsSecretsManagerProvider` against LocalStack through
  standard AWS SDK endpoint configuration. LocalStack is pinned to final
  token-free Community release `4.14.0`; newer releases require an account and
  conflict with this stack's zero-account contract.
- Temporal container is official `temporalio/temporal` CLI dev server with
  bundled Web UI.
- OTel collector is passive and exports basic signal counts to console. Shared
  mock `ObservabilityProvider` (`createMockObservabilityProvider()`) is
  available in `packages/shared-clients` for apps that wire it. No app
  currently does, including `audit-service`; app-level observability
  integration remains future per-app work. No fake SaaS credential path is
  added.
- Shared mock providers remain available for services without local container
  bindings.

## Stop

```bash
docker compose --env-file .env.local down
```

Add `--volumes` only when intentionally deleting local Engine DB data. It also
deletes Platform DB data if that service has been started from this Compose
project.

## Known gaps

No live AWS, Temporal Cloud, Grafana Cloud, Sentry, or LocalStack accounts are
used. Token-free LocalStack `4.14.0` no longer receives upstream updates and
must be reviewed before any production-like use. OTel collector output is
diagnostic only; app-level observability wiring remains a future service
integration task.
