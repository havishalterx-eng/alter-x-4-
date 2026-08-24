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
  engine-db ads-db cost-db redis localstack temporal tempo grafana
docker compose --env-file .env.local ps
```

Expected local endpoints:

- Engine PostgreSQL: `127.0.0.1:5433`, database `audit_db`, role
  `audit_service`
- ADS PostgreSQL: `127.0.0.1:5434`, database `ads_db`, role `ads_core`
- Cost PostgreSQL: `127.0.0.1:5435`, database `cost_db`, role
  `cost_ledger_service`
- LocalStack edge: `http://127.0.0.1:4566`
- Temporal gRPC: `127.0.0.1:7233`
- Temporal Web UI: `http://127.0.0.1:8233`
- Tempo OTLP/gRPC (trace ingest): `127.0.0.1:4317`
- Tempo OTLP/HTTP (trace ingest): `http://127.0.0.1:4318`
- Tempo query API / health: `http://127.0.0.1:3200/ready`
- Grafana UI (anonymous admin, local only): `http://127.0.0.1:3300`

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

### Internal service credential (all Python services)

ENGINE-FIX-P5-SEC-1: ads-core, memory-service, intelligence-service,
eval-service and verification-service all fail closed at boot unless the
SHA-256 of the shared internal token is configured, and every non-health
route/RPC requires it as `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`.
Reuse the two variables exported above for every service you start, e.g.:

```bash
INTERNAL_SERVICE_TOKEN_SHA256="$INTERNAL_SERVICE_TOKEN_SHA256" \
  INTERNAL_SERVICE_TOKEN="$ADS_LOCAL_SERVICE_TOKEN" \
  uv run --project apps/intelligence-service uvicorn src.main:app --app-dir apps/intelligence-service \
  --host 127.0.0.1 --port 8002
```

Callers that speak gRPC to these services (the TS clients in
`packages/adapters/src/grpc/`) take an `authorization: "Bearer …"` config
field fed from `INTERNAL_SERVICE_TOKEN`.

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
- Tracing is a real `grafana/tempo` OTLP receiver (gRPC 4317 / HTTP 4318,
  local disk storage) with `grafana/grafana` wired to it as a datasource for
  browsing traces -- not a passive console-only collector. Shared mock
  `ObservabilityProvider` (`createMockObservabilityProvider()`) is available
  in `packages/shared-clients` for apps that wire it. No app currently sends
  it real traces, including `audit-service`; app-level observability
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
must be reviewed before any production-like use. Tempo/Grafana are real and
running, but no app sends them real traces yet; app-level observability
wiring remains a future service integration task. `presidio-analyzer`/
`presidio-anonymizer` (PII detection for `model-gateway`) and
`cost-ledger-service`'s own HTTP boot are not yet covered by this doc.
