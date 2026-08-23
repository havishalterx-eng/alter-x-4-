# Alter — Task Breakdown & Build Structure

**Version:** 1.0
**Date:** 2026-07-22
**Window:** July 22 → August 2, 2026 (11 days, 7-day weeks)
**Team:** 7 backend engineers (incl. product owner) + UI/UX teammate + assigned frontend implementation owner
**Status:** Freshly derived from Engine spec (docs 03–05, 07–09) and Platform Architecture (doc 02). The old Phase 0–7 plan is retired. This document is the input for CEO-session master-prompt generation.

---

## 1. Build Model

Not sequential phases — **7 parallel workstreams crossing 4 integration milestones**. Dependencies are handled by contracts-first: every workstream codes against `packages/contracts` mocks from day one, so no track blocks another. Milestones are hard integration gates where mocks are progressively replaced by real services.

**Definition of done (every ticket):** implementation → independent Codex Audit approval → tests per Test Plan floors → CEO-session approval. No direct merge to `main`. Merge gate per Test Plan §3.

**Daily cadence:**
- Morning: CEO session reviews progress, resolves cross-stream conflicts, issues/updates master prompts
- Day: parallel Codex Writer sessions per workstream; engineers review + integrate
- Before merge: independent Codex Audit session per PR
- Evening: integration run on ephemeral stack + golden-set smoke; failures triaged before next morning

---

## 2. Workstreams & Ownership

Owners assigned by product owner; slots below are the proposed split.

### WS1 — Foundation, Contracts & Infrastructure (1 engineer + CEO session)
The unblocking stream. Highest priority days 1–2, then continuous.

1. Nx monorepo scaffold per Tech Spec §3.6 (apps/, packages/, infrastructure/)
2. `packages/contracts`: Zod schemas → OpenAPI 3.1.1 generation; proto files for gRPC services (`alter.*.v1`); canonical event schema; WorkflowDAG schema (draft + executable states, `metadata.ui.*` namespace)
3. Provider-adapter framework: interface pattern, capability registry, mock adapter harness, contract-test runner
4. CI: GitHub Actions — merge gate pipeline (lint, typecheck, unit, contract, integration, migration check, tenant-isolation tests, secret/dependency scan, architecture-boundary check)
5. Terraform: 8-account Control Tower landing zone, ap-south-1 network, Aurora clusters (control-plane 7 DBs + ADS), Redis, S3, EventBridge/SQS, AppConfig, Secrets Manager layout, ECS clusters
6. Temporal Cloud namespaces (`engine-*`, `platform-*` per env); Auth0 tenant + Organizations; Vercel org; GitHub org for project repos
7. Local dev: docker-compose stack + LocalStack + Temporal dev server + mock providers; seed/reset scripts
8. Observability bootstrap: OTel collector, Grafana Cloud, Sentry, Langfuse wiring

**Acceptance:** M1 walking skeleton runs; CI green on empty services; `terraform apply` reproducible in dev.

### WS2 — Identity, Tenancy, Platform API Core, Billing (1 engineer)

1. Auth0 integration (email/password + Google), session management, Identity Broker + `X-Alter-Actor-Token` issuance/validation
2. platform_db migrations (tenants, workspaces, users, memberships, entitlements, integrations) with RLS
3. Self-service signup → personal tenant + workspace + free-tier entitlements (all limits config-driven)
4. RBAC guards; tenancy middleware; cross-tenant CI tests
5. Billing: EntitlementProvider + Razorpay adapter (subscriptions), budget enforcement hooks; Stripe adapter stub
6. Marketplace commerce backend: listings, orders, licensing, Razorpay Route payouts, KYC/publisher pipeline states
7. Notification service (in-app + SES email), preferences
8. Admin & Operator Console APIs: tenant admin, support-access grants (JIT, audited), abuse/fraud controls
9. audit-service: hash-chained audit_events, support_access_grants, deletion ledger + certificates

**Acceptance:** signup→workspace→role-scoped API access e2e; payment sandbox order + split settles; audit chain verifies.

### WS3 — Engine Intelligence Pipeline (1 engineer, Python-heavy)

intelligence-service (FastAPI) + orchestration entry: Conversation Manager (FAST intent), Clarification Loop, Planner (kernel + Workflow/Project/ManagerWorker strategies, ADVANCED/CEILING), Capability Resolver, Selection & Binding (capability embeddings 512-dim, auto-creation, performance weighting), Graph Compiler (skeleton → typed DAG: waves, branches, loops, merges, explicit edges; OPT-STD conditional-edge synthesis), Workflow Lifecycle (versioning, canary, rollback), intelligence_db migrations.

**Acceptance:** goal text → valid compiled immutable WorkflowDAG version passing schema validation; injected ambiguity triggers clarification; planner golden set ≥90% valid-DAG; canvas round-trip (draft edit → recompile) works.

### WS4 — Durable Execution & Event Ingestion (1 engineer)

Temporal substrate integration (DurableExecutionProvider + Temporal adapter), Executor (durable graph-walker, parallel waves, per-node alias routing, streaming G10), Node Type Registry (all 11 node types + registry API for palette), Blackboard (Redis + durable checkpoints), Provisioning Service (E2B sessions, scaffolding, env grounding, DI), **Event & Trigger Gateway** (trigger registry, provider adapters incl. WhatsApp webhook, normalizer → canonical event, dedup, Signal-with-Start conversation lifecycle workflows, child runs, scheduler, DLQs), orchestration_db migrations (workflows, versions, triggers, events, conversations, runs, node_executions, run_outcomes).

**Acceptance:** webhook event → conversation workflow → child run → DAG executes node-by-node durably; worker kill mid-run resumes correctly; duplicate webhook executes zero duplicates; run_outcomes row written with verdict per run.

### WS5 — Gateways, Sandbox, Channels & Media (1 engineer)

Model Gateway (alias ladder FAST/STANDARD/ADVANCED/CEILING via AppConfig policy; Bedrock primary, Anthropic + OpenAI fallbacks; Presidio redaction with Indian recognizers; token/cost limits; schema validation; semantic cache 512-dim co-deployed), Tool Gateway (permissions, credential resolution, rate limits, SSRF guard, audit; Tavily search), Sandbox Service in `alter-sandbox-exec` (E2B exec, package mgmt, file ops, import healer, lint/build/render verification via Browserbase+Playwright, placeholder detection, banlists), cost telemetry events from all three gateways → cost queue, media adapters (image gen, Sarvam/Polly TTS, Sarvam/Transcribe STT), telephony adapters (Exotel primary, Twilio), WhatsApp channel provider, community-tool/MCP isolated runtime harness.

**Acceptance:** every LLM/tool/sandbox call flows through its gateway with redaction + cost event; provider-swap contract tests pass (primary/mock/fallback); seeded broken code caught by build+render verification; SSRF suite blocked.

### WS6 — Verification, Recovery, Memory, Cost, Eval & ADS (1 engineer)

Verification & Quality Gate (ADV reviewer + FAST hallucination classifier, severity assessment, conditional re-run), Recovery Policy Engine (failure classification, ADVANCED root-cause, policy-table strategy selection: repair/retry/backoff/swap/escalate/recompile/replan/degrade/ask/terminate), Memory & Learning Service (writeback → ADS memory namespace + Policy Store), Policy Store + Drift Detector (policy_db), Synthesis Service (merge + graceful degrade), Cost Ledger service (cost_db ingest + rollups + margin), Eval & Red-team Harness (eval_db, 9 golden sets, release gates, red-team suites), **ADS Core + ADS Q** (own cluster: sources, documents, chunks 1024-dim, records, memory namespace, ingestion pipeline with validation/scan/chunk/index; ADS Q hybrid retrieval + rerank + provenance + confidence; ADS Client in Engine).

**Acceptance:** bad output → fail verdict → recovery strategy → re-run → pass; graceful degrade produces flagged partial; upload → ingested → retrievable with provenance; eval thresholds per Test Plan §5 gate promotion; VACR computable from run_outcomes.

### WS7 — Platform Frontend & Experience (frontend owner + UI/UX teammate + product owner assists)

Next.js app shell (App Router, Auth0 session, i18n EN+HI keys, design tokens, light/dark/high-contrast), Streaming Gateway consumption (SSE resume/reconnect), shared surfaces (dashboard, command palette + Unified Command chat, Notification Centre, Human Action Centre, run history, cost dashboards, integrations, knowledge management UI, settings incl. data export/right-to-delete), Workflow Mode (list, creation chat, React Flow canvas over WorkflowDAG w/ palette from registry API, data mapping editor, trigger config, simulation, activation, run timeline, node inspector, versions/rollback), Project Mode (brief, plan review, live build, file tree, Monaco diffs, xterm.js terminal, tests, audit report, preview, deploy w/ intelligent routing, repo view, env vars, maintenance), Marketplace (browse/search Postgres FTS, listing detail w/ permissions + trust badges, install/purchase, seller console, publish pipeline, reviews), admin surfaces (minimum: tenant admin, support access, provider health, marketplace governance, audit explorer), `alter` CLI (login, list/run/watch/logs/approvals/deploy/doctor), failure/degraded UX states per doc 02 Part 18.

**Acceptance:** all six UI states per surface; canvas round-trip; SSE survives refresh; axe-core pass; Playwright e2e for both mode flows; EN+HI render.

---

## 3. Integration Milestones (hard gates)

### M1 — Walking Skeleton — **July 24 EOD**
Auth0 login → platform-api (actor token) → Engine stub → Temporal no-op workflow persisted + replayed → SSE echo to browser. Contracts package locked v0 (changes after M1 need CEO approval). Terraform dev environment live. CI merge gate active.

### M2 — Vertical Slices — **July 27 EOD**
**Workflow slice:** simulated WhatsApp webhook → Event Gateway → conversation workflow → planner → compiled DAG → executor (real model calls via Model Gateway) → verification → response node → run_outcomes verdict → visible live in Platform run timeline.
**Project slice:** brief → plan → repo created → scaffold build in E2B → preflight tests → preview deploy to Vercel → visible in Project Studio.
Both slices demo-able end-to-end on staging. Recovery path exercised once (injected failure → retry → pass).

### M3 — Feature-Complete Integration — **July 30 EOD**
All 48 Platform features + all 72 Engine features wired (flag-gated where risky). Marketplace: publish pipeline + sandbox purchase + Route split in test mode. Self-service signup + free tier live on staging. All 9 golden sets running with thresholds measured. Chaos suite executed once; failures triaged. dev→staging gate green.

### M4 — Production Go-Live — **August 2**
staging→prod gates per Test Plan §4 (E2E, red-team, load/SLO, chaos, backup/restore, canary + rollback verified). Cross-system UAT + subsystem sign-offs + CEO review + product-owner go/no-go. Deploy Checklist doc 09 executed top to bottom. Synthetic workflow + synthetic project build succeed in prod. Status page live.

**Slip rule:** if a milestone slips >24h, CEO session re-scopes via feature flags (dark-launch incomplete surfaces) — never by cutting verification, tenancy, audit, or no-silent-failure guarantees. Reliability spine is uncuttable; breadth flags off first (order: marketplace paid flows → media/voice channels → discovery → benchmarking console → CLI).

---

## 4. Cross-Stream Dependency Map

```
WS1 contracts ──► every stream (day 1–2 critical path)
WS2 actor tokens ──► WS7 (auth), WS3/4 (tenancy context)
WS3 compiled DAG ──► WS4 executor (M2)
WS4 registry API ──► WS7 canvas palette
WS4 events ──► WS5 channels (webhook adapters), WS7 timeline
WS5 Model Gateway ──► WS3 (planner calls), WS6 (verification calls)
WS6 ADS Q ──► WS3 (planner context), WS7 knowledge UI
WS6 eval harness ──► all promotion gates (M3, M4)
WS2 billing ──► WS7 marketplace purchase (M3)
```

Mocks stand in for every arrow until the milestone that hardens it.

---

## 5. Master Prompt Requirements (CEO session output)

Every Code Writer master prompt is a `.md` file, caveman-compressed, and must contain:

1. **Scope:** exact component(s), exact repo paths, what NOT to touch
2. **Contracts:** exact schema/proto names from `packages/contracts` to implement against — never invent shapes
3. **Monorepo config context:** Nx targets, pnpm workspace layout, how to run affected tests locally (prevents setup drift)
4. **Real endpoint bindings:** list actual routes/RPCs of dependency services (per backend-binding verification rule) — Writer verifies against real files, not assumptions
5. **Provider law reminder:** vendor SDKs only in adapter packages; mock adapter required
6. **Acceptance criteria:** testable list, coverage floors, which golden set applies
7. **Escape valve:** if stuck looping/retrying >3 attempts on same failure — abort, report state, do not burn tokens
8. **pnpm guard:** check for competing pnpm process before install/add; abort+report, never queue
9. **Ask-permission rule:** confirm before any destructive/irreversible action
10. **Handoff format:** files changed, tests added, known gaps, audit notes

Audit-session prompts additionally require: architecture-boundary verification, tenant-isolation check, secret handling review, contract conformance, and explicit verdict (approve / reject with findings) — compiling is never approval.

---

## 6. Ticket Granularity Rule

CEO session decomposes each workstream item above into tickets of ≤1 engineer-day with: what to build, acceptance criteria, dependencies, effort estimate. Tickets tracked in the shared board; state transitions: `todo → writing → audit → testing → ceo-review → merged`. Every merged ticket maps back to a feature ID (F1–F48 / Engine features 1–62,G1–G10) — nothing orphaned, everything traceable.

---

## 7. Risk Register (build-window specific)

| Risk | Trigger | Response |
|---|---|---|
| Contracts churn after M1 | schema break request | CEO approval required; breaking change = coordinated same-day migration across streams |
| Provider onboarding latency (Razorpay Route KYC, Stripe India, WhatsApp Business API, Auth0 config) | external approval delays | start all account applications day 1 (WS1); test-mode fallbacks; flags |
| Golden-set thresholds failing at M3 | eval below floor | dedicated triage owner (WS6) + CEO reprioritization; thresholds are gates, not suggestions |
| Integration debt piling at evening runs | red integration 2 days running | freeze new feature merges for that stream until green |
| Engineer overload / single-point streams | any stream >1 day behind | CEO rebalances tickets across streams; scope flags per slip rule |
| Aug 2 gate failure | prod gates red on Aug 1 | ship what passes gates with flags off for the rest; never ship red reliability gates |
```
