# Alter Engine — Technical Specification / Architecture Document

**Version:** 1.0
**Date:** 2026-07-21
**Status:** Approved baseline. Supersedes the original Architecture Documentation (Phase 0–7 plan retired). Component/feature set remains the candidate pool until the final capability-set decision at the end of the spec Q&A cycle.
**Scope:** Alter Engine and its sibling data plane (ADS). The Alter Platform (frontend pillar) has its own spec cycle later; only its contract surface with the Engine is defined here.

---

## 1. Architecture Identity

Hybrid architecture: **durable-execution substrate + graph-native node executor + microkernel policy injection**, wrapped in cross-cutting planes.

Three top-level systems:

1. **Alter Engine** — headless execution core. Plans, binds, compiles, executes, verifies, recovers, learns. Deterministic control plane; LLM intelligence only at designated access points.
2. **ADS (Altered Data Storage System)** — sibling, tenant-isolated data and knowledge plane. Not part of the Engine; reached only through the ADS Client.
3. **Alter Platform** — web application shell (Next.js). Only customer-facing surface in v1. Talks to the Engine exclusively through private, versioned APIs.

Two product modes, one Engine:

- **Workflow Mode** — creates, runs, and maintains long-running business workflows (event-driven).
- **Project Mode** — builds, tests, audits, deploys, and maintains complete software projects.

Governing laws:

- **Provider-adapter law:** vendor SDKs live only inside adapter packages behind Alter-owned interfaces. Vendor choices are implementation defaults, never architectural dependencies.
- **Deterministic control plane:** components that enforce policy and decide rollouts contain no LLM calls.
- **Typed contracts:** every inter-component handoff is a validated typed object, never free text.
- **No silent failure:** every run ends in an explicit verdict; verification precedes every external action.
- **Five-store separation:** ADS stores knowledge and evidence; Memory & Learning derives learnings; Policy Store controls future behavior; Temporal stores active durable execution; Blackboard stores temporary run context. No single "memory database" mixes these.

---

## 2. Component Index (31 components + 5 cross-cutting planes)

Components 1–30 as defined in the original architecture doc (feature ownership unchanged), plus:

**31. Event & Trigger Gateway** — owns external event ingestion and trigger configuration.

- **Control plane:** trigger definitions, event-type→workflow mapping, workflow version binding, start/signal/resume decision, cron and schedules, input mapping, enable/disable, concurrency policy, replay policy, dead-letter config, trigger testing, trigger version history.
- **Data plane:** webhooks (WhatsApp, Shopify, CRM, GitHub, etc.), signature verification, timestamp validation, replay-attack prevention, deduplication, payload normalization, tenant/workspace resolution, correlation-key generation, ordering, dispatch to EventBridge/SQS, Temporal start-or-signal.
- Internal modules: Trigger Registry, Provider Adapters, Event Normalizer, Correlation Router, Trigger Dispatcher, Scheduler. One logical component; can split into deployables later.
- **Boundary rule:** *Session Gateway receives people. Event & Trigger Gateway receives machines.* Separate because auth, scaling, retry behavior, payload formats, threat model, and idempotency requirements all differ.
- Also serves Project Mode events: GitHub webhooks, build completion, CI failures, deployment callbacks, preview readiness, review comments, maintenance alerts. No separate Project Mode event system.

**Separate from the 31: Admin & Operator Control Plane** (Alter-internal). Tenant provisioning, service health, provider management, billing ops, global policy deployment, incident response, support access, abuse investigation. Alter staff are **not** members of customer tenants; customer-tenant access is just-in-time, scoped, reason-coded, time-limited, fully audited. Alter also gets a normal internal tenant for dogfooding — distinct from the admin plane.

Cross-cutting planes (unchanged): Eval & Red-team Harness, Type/Schema Contract Plane, Observability Plane, Safety & Policy Plane, Governance & Compliance Plane.

---

## 3. Technology Stack

### 3.1 Languages (polyglot, by workload)

- **TypeScript:** Platform backend, internal APIs, auth/tenancy, workflow definitions, Graph Compiler, Temporal orchestration, streaming, control-plane services, shared contracts.
- **Python:** planner intelligence, agent generation, retrieval/reranking, verification models, evaluation framework, memory compression, drift detection, ML workloads, advanced Project Mode coding agents.

### 3.2 Frameworks

| Layer | Choice |
|---|---|
| Platform frontend | Next.js (App Router) + React + TypeScript, Tailwind, shadcn/ui, TanStack Query, Zustand, React Flow (DAG view), Monaco (code views) |
| Engine control plane | NestJS + Fastify adapter (Node.js, TypeScript) |
| Durable execution | Temporal (TypeScript SDK), separate worker pools per workload |
| Intelligence services | FastAPI + Python + Pydantic + AsyncIO |
| TS data access | Drizzle ORM + PostgreSQL + pgvector |
| Python data access | SQLAlchemy + Alembic (only where Python owns the schema) |
| Sandbox | E2B SDK; Docker-compatible execution abstraction for future providers |
| Browser | Browserbase (infrastructure) + Playwright (interface) |

**Schema ownership rule:** one service owns each database schema; no two frameworks migrate the same tables.

**Agent framework decision:** no LangChain / CrewAI / AutoGen in the core. Alter owns planner, typed DAG, routing, execution policy, recovery, memory governance, verification. External frameworks may appear later only as adapters or node types.

**Temporal's role:** executes Alter's own compiled typed DAG durably. Substrate, not planning framework. Alter workflow definitions stay independent of Temporal-specific objects (DurableExecutionProvider interface).

### 3.3 Internal communication

- gRPC + Protocol Buffers — service-to-service requests
- EventBridge + SQS — async events (FIFO queues where ordering matters)
- WebSockets/SSE — live Platform streaming
- OpenAPI — Platform-to-Engine HTTP contracts

### 3.4 Testing

TS: Vitest, Supertest, Playwright, Testcontainers. Python: Pytest, Hypothesis, Testcontainers. Contract: schema-based contract tests. Load: k6.

### 3.5 Observability

OpenTelemetry → Grafana + Tempo + Loki + Prometheus; Langfuse for LLM traces/evals; Sentry for application errors.

### 3.6 Repository & build

Nx polyglot monorepo; pnpm (TS), uv (Python), Docker, Terraform, GitHub Actions.

```
alter/
├── apps/
│   ├── platform-web/          ├── platform-api/
│   ├── orchestration-service/ ├── intelligence-service/
│   ├── model-gateway/         ├── tool-gateway/
│   ├── sandbox-service/       ├── verification-service/
│   ├── memory-service/        ├── eval-service/
│   └── background-workers/
├── packages/
│   ├── contracts/  ├── workflow-schema/  ├── auth/  ├── tenancy/
│   ├── observability/  ├── policy/  └── shared-clients/
├── infrastructure/
├── tests/
└── docs/
```

### 3.7 Deployment topology

Distributed service-oriented architecture with strong domain boundaries. Not one monolith; not 30 microservices. Components share a deployment only when scaling profile, security boundary, failure domain, release lifecycle, and runtime requirements all match. Twelve production service groups:

1. Platform API and identity
2. Conversation and planning
3. Graph compilation and deployment control
4. Temporal execution workers
5. Model Gateway
6. Tool Gateway
7. Sandbox execution
8. Verification and recovery
9. Memory, policy and drift
10. Synthesis and cost accounting
11. Evaluation and red-team systems
12. Observability and audit pipeline

(+ Event & Trigger Gateway — deploys with group 1 initially or standalone; decide at Task Breakdown. ADS Core is its own deployable.)

Services may split further later without redesigning the domain model.

---

## 4. Locked v1 Providers

| # | Capability | v1 Choice | Notes |
|---|---|---|---|
| 1 | Durable execution | **Temporal Cloud** | Self-host on EKS only if residency/control/cost forces it |
| 2 | Compute | **ECS Fargate** | EKS later only for K8s-specific/GPU/daemon needs |
| 3 | Region | **AWS ap-south-1 (Mumbai)** | Single active region, Multi-AZ; cross-region DR post-v1 |
| 4 | Identity | **Auth0** (Organizations + Universal Login) | Behind OIDC adapter; Cognito swappable later |
| 5 | Models | **Bedrock-first** | Fallback: Anthropic API direct; secondary: OpenAI via Model Gateway |
| 6 | Embeddings | **Titan Text Embeddings V2** | EmbeddingProvider interface; benchmark Voyage later |
| 7 | PII redaction | **Presidio (self-hosted)** | Custom recognizers: Aadhaar, PAN, GSTIN, Indian phone, bank details, tenant-specific fields. Comprehend rejected as sole layer (EN/ES only) |
| 8 | Web search | **Tavily** | Brave later as fallback; all via Tool Gateway |
| 9 | Browser | **Browserbase + Playwright** | No self-run browser fleets initially |
| 10 | Database | **Aurora PostgreSQL Serverless v2** | Convert hot instances to provisioned later if load justifies |
| 11 | Project Mode deploy | **Vercel** default | Later adapters: ECS/Fargate, Lambda, customer cloud, Cloudflare, Fly.io |

### 4.1 Model alias ladder

No component names a model. Aliases resolved by Model Gateway through versioned policy:

| Alias | v1 Resolution |
|---|---|
| `FAST` | Amazon Nova 2 Lite |
| `STANDARD` | Claude Sonnet 5 |
| `ADVANCED` | Claude Opus 4.8 |
| `CEILING` | Claude Fable 5 |

LLM access map (reconciled from original 7-tier index):

| Component | Alias usage |
|---|---|
| Conversation Manager | FAST |
| Safety & Policy Plane (injection classifier) | FAST |
| Clarification Loop | STANDARD |
| Capability Resolver | STANDARD |
| Memory & Learning Service | STANDARD |
| Selection & Binding Engine | embeddings + STANDARD (persona drafting) |
| Graph Compiler | optional STANDARD (conditional-edge synthesis only) |
| Planner | ADVANCED default; CEILING for ceiling-critical decomposition/replanning |
| Recovery Policy Engine | ADVANCED (root-cause only; strategy selection stays policy-table-driven) |
| Synthesis Service | ADVANCED |
| Verification & Quality Gate | ADVANCED reviewer + FAST hallucination classifier |
| Executor / LLMTask nodes | per-node alias declared in WorkflowDAG spec |

Deliberately LLM-free (unchanged): Session Gateway, Event & Trigger Gateway, ADS Client (embeddings only), Cache Layer (embeddings only), Deployment Controller, Durable Substrate, Node Type Registry, Blackboard, Provisioning Service, Model Gateway, Tool Gateway, Policy Store, Drift Detector, Cost Ledger, Observability/Contract/Governance planes.

### 4.2 Provider-adapter law (mandatory)

Alter-owned interfaces — components call these, never vendor SDKs:

```
DurableExecutionProvider  ComputeProvider     IdentityProvider
ModelProvider             EmbeddingProvider   PIIRedactionProvider
SearchProvider            BrowserProvider     DatabaseProvider
DeploymentProvider        ObjectStorageProvider  QueueProvider
SecretsProvider           ObservabilityProvider  SandboxProvider
RepositoryProvider (GitHub first, GitLab later)
```

Rules: provider selected via configuration; no provider-specific types outside adapter package; canonical Alter request/response schemas; provider capability registry (`streaming`, `tool_calling`, `vision`, `structured_output`, `long_context`, `regional_availability`, `data_residency`, `batch_support`, `maximum_payload`, `supported_languages`, `cost_model`); health checks per provider; automatic fallback; contract tests per adapter; mock provider for testing; feature flags for migration; per-tenant overrides where allowed; secrets by reference ID only; normalized provider telemetry; migration/rollback support. Selection & Binding chooses only providers satisfying node requirements — **no silent downgrade**. Switching provider = config + credentials + adapter activation + contract test + capability validation; never a rewrite of Planner/Executor/Verification.

Database portability: repository interfaces, domain-owned schemas, standard PostgreSQL features, separate vector abstraction, no Aurora-specific logic in business services.

---

## 5. Event Ingestion & Triggers

### 5.1 Ingress path

```
WhatsApp / Shopify / CRM / GitHub / cron / external system
        → API Gateway + WAF
        → Event & Trigger Gateway
        → verify → deduplicate → normalize → correlate
        → Canonical Alter Event
        → EventBridge bus
        → SQS (FIFO where ordering matters)
        → Trigger Dispatcher
        → Temporal start or signal
        → Durable Substrate → Executor
```

#### Session Gateway prompt-injection guard (current implementation)

`SessionGatewayPromptInjectionGuard` is implemented as a best-effort HTTP guard for one configurable top-level request-body field (`utterance` by default). For a non-public request that has both that field and an actor tenant, it calls `PromptInjectionClassifier`; a detection returns an RFC 9457-style 400 problem response (`packages/auth/session-gateway/src/prompt-injection.guard.ts:33`, `packages/auth/session-gateway/src/prompt-injection.guard.ts:59`, `packages/auth/session-gateway/src/prompt-injection.guard.ts:80`, `packages/auth/session-gateway/src/prompt-injection.guard.ts:91`). The classifier uses the `FAST` Model Gateway alias and deliberately fails open on a gateway error or unusable classifier output (`packages/auth/session-gateway/src/prompt-injection-classifier.ts:47`, `packages/auth/session-gateway/src/prompt-injection-classifier.ts:84`).

This guard is currently **not registered on a production Session Gateway route**: a current-main repository search finds the class only at its definition, export, and specs. It is therefore an available defense-in-depth component, not evidence that every human ingress request is currently inspected. The Session Gateway's upload allowlist remains the documented live ingress protection; route owners must register this guard after the session/auth guard for the field it actually owns (`packages/auth/session-gateway/src/prompt-injection.guard.ts:33`).

### 5.2 Canonical event schema

```
event_id, event_type, schema_version, tenant_id, workspace_id,
source, source_account_id, subject_id, conversation_id,
correlation_id, causation_id, idempotency_key,
occurred_at, received_at, trigger_id, trigger_version,
payload, payload_reference, signature_status
```

Provider-specific payloads never reach Planner or Executor directly.

### 5.3 Trigger storage

Source of truth: PostgreSQL — tenant- and workspace-scoped, versioned, auditable, bound to an exact WorkflowDAG version. EventBridge rules are generated runtime infrastructure, not truth. Credentials in Secrets Manager + KMS, referenced by credential ID, never embedded in trigger records.

### 5.4 Standing conversations (hybrid model)

- **One durable Conversation Lifecycle Workflow per conversation.** Owns message ordering, conversation state, active objective, waiting states, human handoff, in-flight action tracking, duplicate suppression, close/reopen, long-running context coordination. Stable ID: `tenant:{tenantId}:channel:{channel}:conversation:{conversationId}`. Incoming messages use **Signal-with-Start** (no start-vs-signal races).
- **Separate child execution run per actionable intent.** Each meaningful message/business intent spawns a child run bound to an exact WorkflowDAG version, with independent audit trail, cost record, verification result, recovery history, failure isolation, replayability.
- Protection: continue-as-new past history threshold; idle timeout; conversation state snapshot; ADS writeback for long-term context. Temporal holds active operational state; Blackboard stays scoped per execution run; Memory Service receives only verified outcomes.

---

## 6. ADS — Altered Data Storage System

Alter's governed, tenant-isolated data and knowledge plane. **Answers: "What does this tenant or project know?"**

### 6.1 Position

Separate sibling service — not a Platform feature, not a Memory Service database, not a hidden Engine schema, never directly accessible by Planner or agents.

```
Alter Platform → ADS Ingestion & Administration APIs → ADS Core
Engine's ADS Client → ADS Queue / Retrieval Gateway → ADS Core
```

- **ADS Client (in Engine):** authenticated requests, tenant/project scope enforcement, query construction, response validation, timeouts/fallbacks.
- **ADS Queue (retrieval layer):** read/write jobs, semantic + keyword retrieval, metadata filtering, reranking, context reconstruction, provenance, confidence, backpressure, audit trail.
- **ADS Core (own deployable):** Aurora PostgreSQL for structured metadata, pgvector embeddings, S3 for files/artifacts, OpenSearch when search scale requires, SQS/EventBridge for ingestion/retrieval jobs.

### 6.2 Stores / does not store

**Stores:** customer documents; records synced from CRM/ERP/Shopify/DBs; product/customer/order/inventory/process data; business rules, policies, terminology, preferences; project requirements, assets, architecture decisions, delivery history; verified workflow and project outputs; conversation/project summaries; provenance, permissions, versions, freshness metadata; indexes and embeddings.

**Never stores:** secrets/API keys, active Temporal history, ephemeral Blackboard state, raw unverified model output, routing weights, recovery policies, billing ledger, system logs.

### 6.3 Ingestion sources (all four)

1. Customer uploads (docs, PDFs, spreadsheets, images, knowledge bases, project files)
2. Connected systems (Shopify, CRM, ERP, databases, Drive, support, comms) — scheduled sync, webhooks, direct connector reads, CDC where supported
3. Engine writeback — **only after verification**: outcomes, final artifacts, confirmed facts, approved decisions, run summaries
4. Direct Platform input — rules, corrections, labels, knowledge entries, retention/access settings

Every ingestion path: tenant resolution → validation → malware/content checks → normalization → deduplication → permission assignment → provenance capture → chunking/indexing → versioning.

### 6.4 ADS vs Memory & Learning vs Policy Store

- Memory & Learning Service = processing/governance service, not primary datastore. **Answers: "What did Alter learn about performing better?"**
- Tenant/project knowledge → `Memory & Learning → ADS memory namespace` (e.g., "client requires manager approval above ₹50,000", "customer prefers WhatsApp responses in Telugu").
- Engine operational learning → `Memory & Learning → Policy Store` (routing weights, retry preferences, thresholds, degradation observations).
- Cross-tenant learning: raw tenant data never becomes global memory. Global learnings must be aggregated, anonymized, statistically validated, content-free, irreversibly de-identified, and eval-gated before promotion.

---

## 7. Project Mode Internals

### 7.1 Code residence

- GitHub repository per project, private, inside Alter-controlled GitHub organization (v1). Tenant/project-scoped repo names, protected `main`, all changes on temporary agent branches, merge only after tests + audit + approval.
- Later: customer GitHub org via GitHub App; repo transfer/mirroring; RepositoryProvider adapter (GitHub first, GitLab later).
- S3 stores build logs, screenshots, test reports, deployment bundles, generated assets, archived release snapshots. **Git is the source of truth for code; S3 is not.**

### 7.2 Project state across sessions

Split across: Git (code + history), ADS (requirements, architecture decisions, preferences, verified context), PostgreSQL (project metadata, repo binding, deployment state, runs, permissions), S3 (artifacts), Secrets Manager (env secrets), Temporal (active build state), E2B (temporary working env).

Change-request flow: retrieve ADS context → read project metadata → clone latest approved commit into fresh E2B sandbox → new agent branch → plan + implement → test + audit → commit + controlled merge → deploy approved commit. Sandbox reuse allowed within one active build/repair cycle only; sandbox loss never loses project state.

### 7.3 Planner: one kernel, two strategies

```
Planner
├── Workflow Planner Strategy  → trigger-driven operational DAGs
└── Project Planner Strategy   → build-pipeline DAGs:
    clarify → architecture → scaffold → implement → lint → test
    → security scan → independent code audit → repair → build
    → render verification → deploy preview → acceptance verification
    → production deployment → handoff
```

Shared: goal analysis, clarification, decomposition, capability resolution, agent selection, dependency mapping, dynamic replanning. Strategy controls output graph, quality gates, node types. (Manager/Worker remains a third swappable strategy per original doc.)

### 7.4 Two-layer CI

- **Layer 1 — sandbox preflight (E2B, pre-push):** install, typecheck, lint, unit + integration tests, build verification, render verification, placeholder detection, secret scanning, dependency scanning, Code Audit agent review. Fast feedback; self-healing happens here first.
- **Layer 2 — GitHub Actions (canonical):** clean-environment build, full test suite, security checks, architecture rules, deployment checks, artifact generation, preview deployment. Authoritative external CI result.
- CI failure loop: `GitHub webhook → Event & Trigger Gateway → project lifecycle workflow → Recovery Policy Engine → fresh repair run → audit → push fix → CI rerun`.
- **The implementation agent never approves its own code** — independent Code Audit agent + Quality Gate before merge; Deployment Controller ships approved commits only.

#### Sandbox render verification (current gRPC behavior)

`RunVerificationSuite` now dispatches both `build` and `render`; `render` requires `preview_url`, resolves every declared render file through the artifact service, then calls `SandboxService.verifyRender` (`apps/sandbox-service/src/sandbox/sandbox.grpc-handler.ts:105`, `apps/sandbox-service/src/sandbox/sandbox.grpc-handler.ts:110`, `apps/sandbox-service/src/sandbox/sandbox.grpc-handler.ts:119`, `apps/sandbox-service/src/sandbox/sandbox.grpc-handler.ts:128`). The service first rejects placeholder-bearing files as a render logic failure, otherwise inspects the preview through its configured browser verifier and classifies browser absence, server failures, page/console failures, and successful visible content into the returned verification result (`apps/sandbox-service/src/sandbox/sandbox.service.ts:229`). It is not an unsupported or build-only path.

### 7.5 Promotion patterns

The code deliberately supports two sanctioned promotion patterns because the evidence arrives on different cadences:

- **Agent draft → active: live-traffic confidence building.** Auto-created agents start as `draft` (`apps/intelligence-service/src/agent_auto_creation/engine.py:26`). Each successful real performance observation invokes the promotion check before the observation transaction commits (`apps/intelligence-service/src/performance/repository.py:74`, `apps/intelligence-service/src/performance/repository.py:92`, `apps/intelligence-service/src/performance/repository.py:98`). The check counts successful observations and updates only a still-draft agent to `active` once the configured threshold is met (`apps/intelligence-service/src/performance/repository.py:101`, `apps/intelligence-service/src/performance/repository.py:114`, `apps/intelligence-service/src/performance/repository.py:125`); the configured default is three (`apps/intelligence-service/src/config.py:21`). This is appropriate where confidence accumulates from real execution outcomes, so it does not wait for a batch evaluation run.

- **Workflow version → tested: formal eval release gate.** `testVersion` runs the `workflow E2E` golden set and checks a release gate for that exact workflow/version before changing the version status to `tested` (`apps/orchestration-service/src/deployment-controller/deployment-controller.service.ts:496`, `apps/orchestration-service/src/deployment-controller/deployment-controller.service.ts:497`, `apps/orchestration-service/src/deployment-controller/deployment-controller.service.ts:507`). The eval service persists an auditable approve/block decision only for a completed, scored eval run; its default minimum pass rate is 100% (`apps/eval-service/src/release_gates.py:25`, `apps/eval-service/src/release_gates.py:32`, `apps/eval-service/src/release_gates.py:42`). This is appropriate for versioned, deployable workflow artifacts that need a formal pre-release gate.

These patterns must remain distinct: forcing live agent confidence through a batch eval gate would delay a real-traffic signal, while promoting a deployable workflow version from traffic observations would bypass its explicit release evidence.

---

## 8. Tenancy Model

```
Tenant                          (client org — hardest isolation boundary)
└── Workspace                   (collaboration/operational boundary)
    ├── Project                 (Project Mode)
    │   ├── Repository Binding, Environment, Project Version,
    │   ├── Build Run, Deployment
    └── Workflow                (Workflow Mode — sibling of Project, not child)
        ├── Trigger, Environment, Workflow Version, Workflow Run

Run
├── Node Executions, Verification Results, Recovery Actions,
├── Human Approvals, Cost Events, Artifacts
```

- **Tenant owns:** billing, data residency, global security policy, identity config, tenant-wide integrations, retention, audit policy.
- **Workspace owns:** members/roles, workspace integrations, ADS knowledge scope, shared templates, budgets, default model/tool policies.
- **Project and Workflow are siblings** — a project may later contain workflows but is never required to; a workflow operates independently of any software project.
- **Versions are immutable.** Project version = commit SHA + architecture version + lockfiles + build config + deployment manifest. Workflow version = compiled DAG + node definitions + trigger bindings + model/tool requirements + policy bindings. Runs always reference exact immutable versions.
- **Environments** per Project/Workflow: development, preview/test, staging, production — each with separate credentials, trigger bindings, deployment, variables, approval requirements, cost limits.

---

## 9. Pipeline & Connections

The 34 wires from the original Connections Index remain valid, with these additions:

- **35.** Event & Trigger Gateway → Durable Substrate (start/signal) — machine ingress main flow
- **36.** Event & Trigger Gateway → EventBridge/SQS — canonical event dispatch
- **37.** GitHub/CI/deploy webhooks → Event & Trigger Gateway — Project Mode feedback loop
- **38.** Memory & Learning Service → ADS memory namespace — tenant-knowledge writeback (refines wire 27/28 split)

Recovery loop-backs (22–26), self-learn feedback (29–31), and cost telemetry (32–34) unchanged.

---

## 10. Security Architecture (summary)

- Ingress: API Gateway + WAF in front of both Session Gateway (people) and Event & Trigger Gateway (machines); webhook signature verification, timestamp validation, replay protection at Event Gateway; upload allowlist at Session Gateway. The currently unregistered, fail-open prompt-injection guard is documented in section 5.1 and must not be represented as live ingress coverage.
- Identity: Auth0 Organizations (OIDC adapter); tenant = hardest isolation boundary; workspace-scoped RBAC.
- Secrets: Secrets Manager + KMS; referenced by ID everywhere; never in trigger records, ADS, or code.
- Model calls: Model Gateway only — Presidio PII redaction (with Indian-identifier recognizers), token/cost limits, response schema validation.
- Tool calls: Tool Gateway only — permissions, credential vault, rate limits, input validation, SSRF guard, audit logging.
- Admin plane: JIT scoped support access, reason codes, time limits, full audit; no standing staff access to customer tenants.
- Verification precedes every external action (message send, record write, deploy).

---

## 11. Open Items → Downstream Docs

1. **Final capability-set decision** (include/remove/add over 72 features / 31 components) — end of Q&A cycle.
2. **Data Model doc:** full schemas for control-plane DB, ADS Core, Policy Store, Cost Ledger, trigger registry, run/outcome ledger.
3. **API Spec doc:** Platform↔Engine OpenAPI surface, gRPC service definitions, canonical event + contract schemas.
4. **Task Breakdown:** service-group build order, Event Gateway + ADS Core build cost, co-deployment decisions, three-session (CEO/Writer/Auditor) allocation.
5. **Deploy Checklist:** Temporal Cloud namespace setup, ap-south-1 environment topology, Vercel org, GitHub org, Auth0 tenant.
6. ADS Core ingestion/admin APIs sit on the Platform boundary — ownership split confirmed at Platform Q&A.
