# ALTERX

Alter — autonomous execution platform. Two modes: **Workflow Mode** (creates, runs, maintains intelligent business workflows) and **Project Mode** (builds, tests, audits, deploys, maintains complete software). One shared Engine.

## Repository layout

```
apps/
  platform-web/            Next.js Platform frontend (UI builder)
  platform-api/            NestJS Platform BFF — the only caller of Engine/ADS (Platform builder)
  orchestration-service/   Engine: workflows, runs, triggers, events (Engine builder)
  intelligence-service/    Engine: planner, capability, binding (Python/FastAPI)
  model-gateway/           Engine: only path to LLM providers (+ semantic cache)
  tool-gateway/            Engine: only path to external tools
  sandbox-service/         Engine: E2B code execution (deploys to alter-sandbox-exec)
  verification-service/    Engine: quality gates + recovery
  memory-service/          Engine: memory, policy store, drift
  eval-service/            Engine: golden sets, red-team, release gates
  background-workers/      Temporal workers (engine + platform namespaces)
  ads-core/                ADS: pgvector cluster, ingestion, retrieval, embeddings (Python/FastAPI)
  audit-service/           Engine: audit trail, event log (NestJS)
  cost-ledger-service/     Engine: cost tracking, billing rollups (NestJS)
  provisioning-service/    Engine: resource provisioning (NestJS)
packages/
  contracts/               SHARED — schemas, OpenAPI, protos. Changes need repo-owner approval.
  adapters/                Postgres store providers, gRPC clients/transports, queue handling, SSRF-safe fetcher, observability wiring
  auth/ tenancy/ observability/ shared-clients/
infrastructure/            Terraform (8-account AWS layout, ap-south-1)
tests/                     Cross-service integration + e2e
docs/                      Decision notes, local-dev guide, runbooks, full spec documents (PRD, architecture, API, data model, test plan, deploy)
```

## Working rules

1. Nobody pushes to `main`. Branch per task → PR → CI green → Codex Audit → human review → squash-merge.
2. Branches separate **tasks**; folders separate **people**. Branches live hours, not weeks.
3. `packages/contracts` is law — any change requires repo-owner approval (CODEOWNERS enforces).
4. Phase completion = tag on `main`: `engine-foundation-v1`, `platform-identity-v1`, `ui-product-core-v1` …
5. Vendor SDKs only inside provider adapter packages. Architecture-boundary CI check fails violations.
6. Every service validates its env schema on startup. Secrets by reference only — never values in code or config.

## Build sequence

Engine backend phases: Foundation → Gateways → Ingress → Planning → Execution → Self-Healing → Knowledge → Output → Hardening.
Platform backend phases: Identity → Product Core → Connections → Money → Marketplace → Engagement → Operations.
UI builds each surface after its enabling phase's push lands — the OpenAPI diff in that push is the UI work order.

Full specifications live in the `alter-engine-docs` document set (PRD, Platform Architecture, Tech Spec, Data Model, API Spec, Task Breakdown, Env & Config, Test Plan, Deploy Checklist, phase plans).
