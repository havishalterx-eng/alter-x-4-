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
pnpm nx run ads-core:migrate
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

## Run background-workers

Background-workers is a NestJS process that runs the Executor Temporal worker,
cost-events SQS consumer, canonical-events SQS consumer, and platform jobs
Temporal worker. It exposes only an HTTP health endpoint.

```bash
set -a
source .env.local
set +a
NODE_ENV=development pnpm nx run background-workers:serve
```

Requires the full dependency stack (Temporal, LocalStack/SQS, Redis) plus
running instances of orchestration-service, cost-ledger-service, and
platform-api. Without Temporal and SQS the workers will fail to start.

## Run eval-service

eval-service is a FastAPI service (Python) providing evaluation, golden-set,
and red-team capabilities. It has both HTTP and gRPC surfaces.

```bash
pnpm nx run eval-service:migrate
NODE_ENV=development pnpm nx run eval-service:serve
```

Health check (HTTP, default port from uvicorn is 8000):
```bash
curl --fail --silent http://127.0.0.1:8000/health
```

eval-service has the most cross-service dependencies of any service: it needs
Postgres (multiple databases via its config defaults), model-gateway,
verification-service, tool-gateway, memory-service, intelligence-service,
audit-service, and Auth0 M2M credentials. It effectively cannot run without
most of the platform already started. Set `INTERNAL_SERVICE_TOKEN` and its
corresponding `INTERNAL_SERVICE_TOKEN_SHA256` consistently with memory-service.

## Run intelligence-service

intelligence-service is a FastAPI service (Python) providing planner,
capability resolution, and agent binding. It has HTTP surfaces (planner,
problem-understanding, selection-binding, performance) and a gRPC surface
(capability_resolver).

Apply migrations and start:
```bash
pnpm nx run intelligence-service:migrate
NODE_ENV=development pnpm nx run intelligence-service:serve
```

Health check (HTTP, default port 8000):
```bash
curl --fail --silent http://127.0.0.1:8000/health
```

Depends on engine-db (Postgres, port 5433 â€” `intelligence_db`), model-gateway
gRPC (default `localhost:50051`), sandbox-service gRPC (default `localhost:50057`),
and memory-service HTTP (default `http://localhost:8002`). Auth0 M2M credentials
are optional for local (`AUTH0_M2M_*` can be empty when `ALTER_ENV=local`).

## Run memory-service

memory-service is a FastAPI service (Python) providing memory learning,
policy store, and drift detection. It exposes three HTTP routers:
`memory_learning`, `policy_store`, `drift`.

Apply migrations and start:
```bash
pnpm nx run memory-service:migrate
PORT=8002 NODE_ENV=development pnpm nx run memory-service:serve
```

Health check (HTTP, port 8002):
```bash
curl --fail --silent http://127.0.0.1:8002/health
```

Depends on engine-db (Postgres, port 5433 â€” `policy_db`), orchestration-service
HTTP (default `http://127.0.0.1:3000`), intelligence-service HTTP, ads-core HTTP,
and cost-ledger-service HTTP. Protected by `INTERNAL_SERVICE_TOKEN_SHA256` â€”
export this consistently with `INTERNAL_SERVICE_TOKEN` used by calling services.

## Run model-gateway

model-gateway is a NestJS service providing the only path to LLM providers
(Bedrock primary, Anthropic/OpenAI optional failovers) plus a semantic cache.
It has both HTTP and gRPC surfaces.

```bash
set -a
source .env.local
set +a
NODE_ENV=development pnpm nx run model-gateway:serve
```

Health check (HTTP):
```bash
curl --fail --silent http://127.0.0.1:$PORT/health
```

Requires Redis (port 6379, for cache), Presidio analyzer/anonymizer
(ports 5001/5002, for PII redaction), and LocalStack (port 4566, for
AppConfig and SecretsManager). With `ALTER_CONFIG_SOURCE=mock` and
`ALTER_ENV=local`, model providers and AWS services are replaced by mock
implementations â€” this is the recommended local mode.

## Run orchestration-service

orchestration-service is the Engine's largest NestJS service. It hosts 8
separate gRPC microservices (conversation, compiler, deploy-ctl, registry,
nodeexec, blackboard, recovery, runs, artifact-content) plus an HTTP surface,
all in one process. It starts with OpenTelemetry tracing preloaded.

```bash
set -a
source .env.local
set +a
NODE_ENV=development pnpm nx run orchestration-service:serve
```

Health check (HTTP):
```bash
curl --fail --silent http://127.0.0.1:$PORT/health
```

Requires Redis (port 6379, for Blackboard cache), Postgres (for conversation
state via Drizzle), model-gateway gRPC (port 50051), tool-gateway gRPC,
sandbox-service gRPC, verification-service gRPC, memory-service HTTP, and
intelligence-service/planner HTTP. Has drizzle migrations under
`apps/orchestration-service/drizzle/`. Tagged `security-critical`.

## Run platform-api

platform-api is the Platform's NestJS BFF â€” the edge service handling
identity (Auth0/Google), signup, billing, marketplace, integrations,
env vars, credentials, registry, publisher, entitlements, and admin tenants.
It starts with OpenTelemetry tracing preloaded.

Migrate the database first, then serve:
```bash
pnpm --filter @alterx/platform-api db:migrate
NODE_ENV=development pnpm nx run platform-api:serve
```

Health check (HTTP, default port 3000):
```bash
curl --fail --silent http://127.0.0.1:3000/health
```

Requires platform-db (Postgres, port 5432). `IDENTITY_PROVIDER` and
`EMAIL_PROVIDER` both default to `mock` in code
(`apps/platform-api/src/identity/identity.module.ts`,
`packages/adapters/src/ses/resolve-email-provider.ts`) â€” leave them unset
and Auth0/Google OAuth and SES are already replaced by mock
implementations, no `.env.local` entry needed. `ALTER_CONFIG_SOURCE=local-file`
*is* set in `.env.local` and is what replaces AppConfig with the mock.
Marketplace still needs a real Postgres-backed `MARKETPLACE_DATABASE_URL`
for entitlement and credential-guard specs.

## Run platform-web

platform-web is the Platform's frontend â€” a React SPA built with Vite.
It has no server-side runtime; all API calls go to platform-api or proxied
Engine services.

```bash
NODE_ENV=development pnpm nx run platform-web:serve
```

Vite dev server runs on port 5173 by default:
```bash
curl --fail --silent http://127.0.0.1:5173/
```

Requires platform-api (and/or Engine services) to be running for any
functional use beyond the static UI shell. Build for production with
`pnpm nx build platform-web` and preview with `pnpm nx preview platform-web`.

## Run provisioning-service

provisioning-service is a NestJS service handling resource provisioning
with both HTTP and gRPC surfaces.

```bash
set -a
source .env.local
set +a
NODE_ENV=development pnpm nx run provisioning-service:serve
```

Health check (HTTP, default port 3000):
```bash
curl --fail --silent http://127.0.0.1:3000/health
```

Requires LocalStack (port 4566, for SecretsManager to read E2B API key
references). With `ALTER_CONFIG_SOURCE=mock` and `ALTER_ENV=local`, AWS
SecretsManager and the E2b sandbox provider are replaced by mock
implementations. Tagged `security-critical`.

## Run sandbox-service

sandbox-service is a NestJS service managing code execution sandboxes (E2b
primary) and browser automation (Browserbase). It has both HTTP and gRPC
surfaces.

```bash
set -a
source .env.local
set +a
NODE_ENV=development pnpm nx run sandbox-service:serve
```

Health check (HTTP):
```bash
curl --fail --silent http://127.0.0.1:$PORT/health
```

Requires LocalStack (port 4566, for SecretsManager and AppConfig), and the
artifact-content gRPC service from orchestration-service (port 50061). With
`ALTER_CONFIG_SOURCE=mock` and `ALTER_ENV=local`, sandbox providers (E2b,
AgentCore) and Browserbase are replaced by mock implementations.

## Run tool-gateway

tool-gateway is a NestJS service providing the only path to external tools
(search via Tavily, database, browser automation, web fetch with SSRF
guarding). It has both HTTP and gRPC surfaces.

```bash
set -a
source .env.local
set +a
NODE_ENV=development pnpm nx run tool-gateway:serve
```

Health check (HTTP):
```bash
curl --fail --silent http://127.0.0.1:$PORT/health
```

Requires Redis (port 6379, for cache), LocalStack (port 4566, for
SecretsManager, AppConfig, SQS), and audit-service gRPC for tool-call
audit logging. With `ALTER_CONFIG_SOURCE=mock`, external tool providers
(Tavily, Browserbase) are replaced by mock implementations.

## Run verification-service

verification-service is a FastAPI service (Python) providing quality gates
and recovery orchestration. It has an HTTP surface (quality evaluation)
and a separate gRPC server (severity assessment).

Start the HTTP server:
```bash
NODE_ENV=development pnpm nx run verification-service:serve
```

Start the gRPC server (separate process, in another terminal):
```bash
NODE_ENV=development pnpm nx run verification-service:serve-grpc
```

Health check (HTTP, default port 8000):
```bash
curl --fail --silent http://127.0.0.1:8000/health
```

Minimal external dependencies: requires model-gateway gRPC (port 50051)
and, optionally, memory-service HTTP for quality-threshold policy lookups.
Protected by `INTERNAL_SERVICE_TOKEN_SHA256`. No database of its own â€”
no migrations needed.

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
wiring remains a future service integration task.

`presidio-analyzer`/`presidio-anonymizer` containers (PII redaction for
`model-gateway`, ports 5001/5002) are not started by the dependency stack's
`docker compose` command above â€” model-gateway's mock mode works without them,
but real Presidio requires manually starting those containers.

`cost-ledger-service`'s own HTTP boot still needs a LocalStack
`database_credentials` secret to be seeded before full serve can succeed
(migration-only path is documented above).

`background-workers` and `eval-service` effectively cannot function without
most of the platform already running (Temporal, SQS, 10+ downstream services
respectively) â€” they are documented here for completeness but are not
independently runnable in isolation.
