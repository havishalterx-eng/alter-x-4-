# Running the eval golden sets by hand

The golden sets were only ever driven from
`apps/eval-service/tests/test_orchestrator_integration.py`, which builds every
dependency as a pytest fixture on an ephemeral port. Outside pytest there was
no way to know which of eval-service's 28 addresses points at a production
service and which needs a dedicated eval-only helper, so a baseline nobody
could reproduce was the only baseline there was.

This runbook is that mapping, plus the two scripts that make a run repeatable.

## Run one

```sh
docker compose up -d
npx nx run-many -t build --projects=orchestration-service,platform-api,tool-gateway,model-gateway

set -a; . ./.env.local; set +a
sh scripts/run-eval-helpers.sh                 # the eval-only helpers
# then the production services the set needs -- see the table below
ALTER_SERVICE_TOKEN="$INTERNAL_SERVICE_TOKEN" \
  node scripts/run-golden-set.mjs intent
```

`scripts/run-eval-helpers.sh --stop` stops what it started; logs land in
`.eval-helpers/logs/`.

Two things that read as broken services rather than as what they are:

- **`16 valid bearer service credential is required`** — eval-service is behind
  the same `ServiceAuthGuard` as every other gRPC surface. The credential is
  the shared `INTERNAL_SERVICE_TOKEN` from `.env.local`, not an Auth0 M2M JWT;
  `scripts/local-m2m-token.sh` mints the wrong kind of token for this one.
- **A whole set scoring zero** — eval-service resolves its gRPC channels once
  at startup. Start it *after* the services it dials, or restart it; otherwise
  every case fails on a channel that was created against a closed port.

## What backs each address

`ALTER_CONFIG_SOURCE=mock` is enough for everything below except
model-gateway, which needs real inference for four of the five sets — see
`scripts/run-model-gateway-aws.sh`.

### Eval-only helpers — `scripts/run-eval-helpers.sh` starts these

These exist because production's own entrypoint cannot serve the case. The
HTTP ones apply `SessionGatewayGuard` globally, so a request without a real
signed JWT is a 401 rather than the 404 the tenant-isolation set asserts; the
gRPC ones would otherwise boot the whole monolith (Temporal, Planner, every
pool) to exercise one service; and ads-core's seeds the retrieval corpus that
production has no reason to carry.

| Setting | Helper | Port |
| --- | --- | --- |
| `SECURITY_EVAL_BASE_URL` | orchestration `eval_security_http_server.js` | 3005 |
| `RUN_VISIBILITY_BASE_URL` | orchestration `eval_run_visibility_http_server.js` | 3006 |
| `WORKFLOW_BASE_URL` | orchestration `eval_workflow_read_http_server.js` | 3007 |
| `PROJECT_BASE_URL` | orchestration `eval_project_read_http_server.js` | 3008 |
| `TRIGGER_REGISTRY_BASE_URL` | orchestration `eval_trigger_registry_http_server.js` | 3011 |
| `CREDENTIAL_BASE_URL` | platform-api `eval_credential_http_server.js` | 3012 |
| `IDEMPOTENCY_TENANT_A_BASE_URL` | platform-api `eval_credential_http_server.js` | 3013 |
| `IDEMPOTENCY_TENANT_B_BASE_URL` | platform-api `eval_credential_http_server.js`, second tenant | 3014 |
| `RECOVERY_GRPC_TARGET` | orchestration `eval_recovery_grpc_server.js` | 50071 |
| `TOOL_CONSUME_GRPC_TARGET` | tool-gateway `eval_credential_grpc_server.js` | 50072 |
| `RETRIEVAL_GRPC_TARGET` | ads-core `src.query.eval_grpc_server` | 50073 |
| `TENANT_ISOLATION_RETRIEVAL_GRPC_TARGET` | same server as above | 50073 |

The helpers seed fixture rows and run migrations against whatever database
they are given. The harness gives each its own throwaway Postgres; the script
gives them the local compose databases instead, which is the point — the
retrieval corpus has to exist somewhere — but it does mean a run writes into
your local `orchestration_db`, `platform_db` and `ads_db`.

Their fixture identifiers are not arbitrary. eval-service's own
`orchestrator.py` asserts against the same literals and ads-core seeds its
corpus under them, so a different tenant or scope id scores zero rather than
failing loudly. They are kept byte-identical between the script and
`test_orchestrator_integration.py`.

### Production services — start these the normal way

| Setting | Service | Port |
| --- | --- | --- |
| `INTENT_GRPC_TARGET` | orchestration-service `ConversationService` | 50052 |
| `VERIFICATION_GRPC_TARGET` | verification-service | 50054 |
| `VERIFICATION_SEVERITY_GRPC_TARGET` | verification-service | 50054 |
| `PLANNER_BASE_URL` | intelligence-service | 8000 |
| `AGENT_BINDING_BASE_URL` | intelligence-service | 8000 |
| `MODEL_GATEWAY_GRPC_TARGET` | model-gateway | 50051 |
| `TOOLGW_GRPC_TARGET` | tool-gateway | 50053 |
| `AUDIT_GRPC_TARGET` | audit-service | 50068 |
| `UPLOAD_EVAL_BASE_URL` | ads-core | 3003 |
| `INGESTION_BASE_URL` | ads-core | 3003 |
| `POLICY_BASE_URL` | memory-service | 8002 |
| `MEMORY_DRIFT_BASE_URL` | memory-service | 8002 |

The harness spawns these from the same production entrypoints (`uvicorn
src.main:app`, `main.js`), just against its own databases, so pointing at the
locally running service is legitimate rather than a shortcut.

`eval_bootstrap.ts` exists in model-gateway and audit-service as an
alternative to their production entrypoints; the harness uses it because it
takes a plain `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` env var instead of AWS
Secrets Manager. With `scripts/run-model-gateway-aws.sh` the real entrypoint
works, so the table names that.

## Which services each set actually needs

| Set | Needs |
| --- | --- |
| `intent` | model-gateway, orchestration-service, `security` helper (the screen runs first) |
| `verification` | model-gateway, verification-service |
| `planner` | intelligence-service |
| `injection` | model-gateway, `security` helper |
| `retrieval` | `retrieval` helper only — no model-gateway; its embeddings are deterministic and local |

## Baseline, 2026-09-09, real Bedrock (Amazon Nova micro/lite/pro)

| Set | Score | Note |
| --- | --- | --- |
| `retrieval` | 20/20 | was 0/20 against ads-core's production entrypoint |
| `injection` | 22/25 | was 8/25 before the classifier payload fix |
| `verification` | 16/20 | model-quality limited |
| `planner` | 9/20 | 11 cases hit an unimplemented `decompose` operation |
| `intent` | 15/30 | was 26/30; 15 cases are now blocked by the injection screen |

The last row is a real regression and not a harness artefact: with the screen
working, Nova micro classifies "run the invoice workflow"-shaped utterances as
injection attempts, and `ClassifyIntent` answers `INVALID_ARGUMENT` before
classifying. `retrieval` moving 0 to 20 is the reverse: nothing was wrong with
retrieval, the address was pointing at a service that has neither the corpus
nor the scope, and refusing an unknown scope is correct tenant isolation.
