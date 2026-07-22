# Alter Engine — Backend Build Phases

**Version:** 1.0
**Date:** 2026-07-22
**Sequence position:** Track 1 of the build. Engine backend completes phase by phase; Platform backend (doc 12) follows; UI developers begin each surface as soon as the enabling phase's git push lands on `main`.
**Derived from:** Tech Spec (03), Data Model (04), API Spec (05), Env & Config (07), Test Plan (08).

**How to read each phase:** *What we build* = components and code. *Why this order* = dependency logic. *APIs that exist after this phase* = the contract surface frozen by the phase's merge. *What UI can start* = the signal to the UI/UX team — what this phase makes designable and buildable against real or contract-locked data. Every phase ends with a git push to `main` that passes the full merge gate (Test Plan §3) plus the phase's own exit checks.

**Phase naming:** plain names are canonical. (Earlier drafts coded these E1–E9; mapping: Foundation=E1, Gateways=E2, Ingress=E3, Planning=E4, Execution=E5, Self-Healing=E6, Knowledge=E7, Output=E8, Hardening=E9.)

---

## Foundation Phase — Contracts, Infrastructure & Durable Substrate

**Duration estimate:** 2 days
**What we build:**
- Nx monorepo (Tech Spec §3.6), `packages/contracts` v0: WorkflowDAG schema (draft + executable states, 11 node types, `metadata.ui.*`), canonical event schema, actor-token claims, RFC 9457 error envelope, SSE envelope, gRPC protos for all `alter.*.v1` services, OpenAPI 3.1.1 generation.
- Provider-adapter framework: base interfaces, capability registry, mock harness, contract-test runner. This pattern is copied by every later phase — it is finalized here.
- Terraform: 8-account landing zone, ap-south-1 network, control-plane Aurora (7 databases, per-service credentials, RLS bootstrap), ADS cluster shell, Redis, S3, EventBridge/SQS + DLQs, AppConfig, Secrets Manager hierarchy, ECS, ECR.
- Temporal Cloud namespaces (`engine-dev/staging/prod`); DurableExecutionProvider + Temporal adapter; no-op workflow proving persist + replay + resume after worker kill.
- audit-service skeleton (hash-chained `audit_events`), cost event queue, OTel → Grafana Cloud pipeline, Sentry, local docker-compose + LocalStack + mock providers, CI merge gate live.
- All external provider account applications submitted (Temporal, Auth0, Razorpay/Route, Stripe, WhatsApp Business, E2B, Browserbase, Tavily, Vercel, GitHub org, Sarvam, Exotel) — clocks start now.

**Why first:** contracts are the only true serialization point; the substrate (Temporal) is the spine every later phase stands on; retrofitting auth trust, tenancy, or durability later is the most expensive mistake available.

**APIs after this phase:** none public — contracts package + health endpoints only.
**What UI can start:** design tokens architecture, app shell, component library, auth page designs, mock-server scaffolds generated from OpenAPI v0. No live data yet — this phase's push means "contracts are law; generate your typed client now."

**Exit checks:** Temporal workflow survives worker kill + replay; `terraform apply` reproducible; CI gate enforced; contracts v0 tagged (changes now need CEO approval); local stack boots <30 min.

---

## Gateways Phase — Model Gateway & Tool Gateway

**Duration estimate:** 1.5 days
**What we build:**
- **Model Gateway** (deployable includes Cache Layer): the only path to any LLM. Alias ladder `FAST/STANDARD/ADVANCED/CEILING` resolved via AppConfig-versioned policy → Bedrock primary (Nova 2 Lite, Sonnet 5, Opus 4.8, Fable 5), Anthropic direct fallback, OpenAI secondary — automatic failover with capability checks, no silent downgrade. Presidio PII redaction (Aadhaar/PAN/GSTIN/phone/bank recognizers) on every outbound prompt. Token + cost limits per tenant/run. Response schema validation. Semantic cache (512-dim, Titan V2) checked pre-spend. Cost event emitted per call.
- **Tool Gateway**: the only path to external tools. Permission model, credential resolution by reference (Secrets Manager), rate limits, input validation, SSRF guard, full audit logging. Tavily search adapter as first tool. Cost events per call.
- Embedding service wrapper (EmbeddingProvider → Titan V2; 1024/512 spaces with mandatory metadata).

**Why now:** everything intelligent downstream (planner, verification, executor LLM nodes) calls models — building the choke point first means no component ever grows a direct vendor dependency that must be unpicked later. Same logic for tools.

**APIs after this phase:** `alter.modelgw.v1` (invoke, stream, redact), `alter.toolgw.v1` (invoke, fetch) — internal gRPC; cost events flowing.
**What UI can start:** nothing new user-facing (internal plane) — but the cost-event stream now exists, so cost-dashboard data contracts are real; UI can build cost display components against contract fixtures.

**Exit checks:** alias→model resolution via config only; provider-swap contract tests pass (primary/mock/fallback); Presidio catches seeded Indian identifiers; SSRF suite blocked; cost events land in queue with correct attribution.

---

## Ingress Phase — Session Gateway, Conversation Manager, Event & Trigger Gateway

**Duration estimate:** 2 days
**What we build:**
- **Session Gateway**: authenticated human ingress. Validates Auth0 M2M + `X-Alter-Actor-Token` (5-min, jti-checked), tenant resolution, rate limiting, upload allowlist, prompt-injection detection (FAST classifier) at ingress.
- **Conversation Manager**: intent classification (answer/plan/workflow/execute/modify) on FAST tier, active-goal tracking, pause/resume conversation state.
- **Event & Trigger Gateway** (component 31): machine ingress. Control plane — trigger registry in PostgreSQL (tenant/workspace-scoped, versioned, bound to exact WorkflowDAG versions), cron scheduler, input mapping, concurrency/replay/DLQ policy, trigger testing endpoints. Data plane — webhook receivers (WhatsApp first), signature verification, timestamp validation, replay-attack prevention, deduplication (idempotency keys), payload normalization → canonical Alter event, correlation routing, EventBridge/SQS dispatch (FIFO where ordered), Temporal Signal-with-Start.
- **Conversation lifecycle workflows**: one durable Temporal workflow per conversation (`tenant:{t}:channel:{c}:conversation:{id}`), message ordering, duplicate suppression, child-run spawning per actionable intent, continue-as-new + idle timeout.
- orchestration_db migrations: workflows, triggers, trigger_versions, events, conversations, runs (skeleton), with RLS.

**Why now:** "Session Gateway receives people, Event Gateway receives machines" — both ingress paths must exist before anything can be asked of the Engine. Conversation lifecycle is the backbone of Workflow Mode's event-driven reality.

**APIs after this phase:** `/api/v1` skeleton: `/events` (read), `/conversations` + actions, `/triggers` + versions + enable/disable/test; webhook ingress `/ingress/{provider}/{integration_id}`.
**What UI can start:** **Trigger configuration surface** (create/test/enable triggers — real API), **conversations list/detail** (real data), webhook endpoint management UI. Event inbox views.

**Exit checks:** signed WhatsApp test webhook → canonical event → conversation workflow signal-with-start → child run stub; duplicate webhook = zero duplicate execution; out-of-order messages ordered; injection classifier blocks seeded attacks; trigger bound to explicit DAG version.

---

## Planning Phase — Planning & Compilation Pipeline

**Duration estimate:** 2.5 days
**What we build:**
- **ADS Client stub** (contract-complete, returns empty context until the Knowledge Phase — planner never blocks on it).
- **Planner** (intelligence-service, Python): kernel + three strategies — Workflow Planner (trigger-driven operational DAGs), Project Planner (build-pipeline DAGs: clarify→architecture→scaffold→implement→lint→test→security→audit→repair→build→render→preview→acceptance→deploy→handoff), Manager/Worker. ADVANCED tier; CEILING for ceiling-critical decomposition. Ambiguity flagging. Dynamic replanning entry point.
- **Clarification Loop**: pauses run, generates minimal precise questions (STANDARD), merges answers back through Conversation Manager.
- **Capability Resolver**: per-node capability/model-tier/tool requirement inference (STANDARD).
- **Selection & Binding Engine**: vector match on 512-dim capability embeddings, performance-weighted routing, agent auto-creation (STANDARD drafts personas), dynamic model routing. intelligence_db migrations (agents, agent_versions, capability_embeddings, performance_records).
- **Graph Compiler**: bound skeleton → typed, versioned, immutable WorkflowDAG — waves, sequences, conditional branches, loops, merges, developer-hardcoded edges; OPT-STD conditional-edge expression synthesis; draft-vs-executable lifecycle; schema validation; `metadata.ui.*` passthrough (runtime-ignored).
- **Deployment Controller** (co-deployed with compiler group): DAG version store, canary routing, automatic rollback on regression.

**Why now:** the full "understand → decide → compile" chain, built while execution doesn't exist yet — planning bugs cost nothing expensive here. Gateways from the Gateways Phase gives it real model access.

**APIs after this phase:** `/workflows` CRUD + `/workflows/{id}/versions` + `actions/compile|simulate(stub)|rollback`; `/projects` CRUD + versions; `/runs/{id}/clarifications/{cid}/answer`; Node Type Registry read API (palette source).
**What UI can start:** **Workflow creation chat** (goal → clarification → generated DAG draft — real), **canvas** (React Flow over real draft DAGs, palette from registry API, edit → recompile round-trip), **workflow review + versions surfaces**, **project brief + clarification + plan review surfaces**. This phase is the single biggest UI unlock for creation flows.

**Exit checks:** goal text → valid compiled immutable DAG passing schema validation; injected ambiguity → clarification question → merged answer → replan; canvas round-trip (draft edit → validate → recompile) proven via API; planner golden set executable; auto-creation produces registrable agent; canary logic works on dummy version bump.

---

## Execution Phase — Registry, Executor, Blackboard, Provisioning, Sandbox

**Duration estimate:** 2.5 days
**What we build:**
- **Node Type Registry**: all 11 handlers — LLMTask, ToolCall, SandboxExec, Gate, HumanApproval, Merge, Synthesis(stub until the Output Phase), MemoryWrite(stub until the Knowledge Phase), PubSub, GroupChat, YAMLImport. Registry API feeds the Platform palette.
- **Executor**: durable graph-walker on Temporal — parallel wave execution, sequential ordering, per-node alias routing through Model Gateway, tool calls through Tool Gateway, Blackboard read/write, live streaming of node transitions + model deltas (G10) via SSE.
- **Blackboard**: Redis hot context per run + durable checkpoints (Redis loss degrades speed, never correctness).
- **Provisioning Service**: E2B sandbox spin-up/reuse (persistent within one build/repair cycle), project scaffolding, env-var grounding via SecretsProvider refs, dependency injection.
- **Sandbox Service** (deployed in `alter-sandbox-exec` account): E2B exec, file read/write/edit, package management (npm/pnpm/pip), import auto-healer, lint auto-fix, build verification (infra-vs-logic failure distinction), render verification (Browserbase + Playwright), placeholder detection, crash-prevention banlists; browser automation, URL fetch, DB operation tool, calculator; cost events for sandbox compute.
- runs + node_executions fully populated; `/runs/{id}/stream` SSE live.

**Why now:** the largest surface area, built only after contracts (Foundation), gateways (Gateways), ingress (Ingress), and compiled DAGs (Planning) exist — execution bugs are the most expensive to debug, so everything it depends on is already tested.

**APIs after this phase:** `POST /runs` + `/runs` list/detail, `/runs/{id}/stream` (SSE: run.status, node.started/completed/failed, model.delta), `/runs/{id}/node-executions`, `actions/cancel|retry-node`; `/projects/{id}/builds` + build stream; `/artifacts/{id}`.
**What UI can start:** **Run timeline** (live SSE), **node inspector** (real I/O refs, status, attempts), **embedded terminal panel** (sandbox/build output streams), **project build progress + file tree + terminal**, **artifacts browser**, **run history**. The observability heart of both modes becomes buildable here.

**Exit checks:** full DAG executes node-by-node durably; worker kill mid-run → resume → complete; parallel wave proven; sandbox catches seeded broken code (build + render + placeholder); Redis flush mid-run → run completes correctly; SSE resume via Last-Event-ID works.

---

## Self-Healing Phase — Verification & Recovery

**Duration estimate:** 2 days
**What we build:**
- **Verification & Quality Gate**: reviewer-agent scoring (ADVANCED) against per-node quality standards, FAST hallucination classifier, safety severity assessment (heal-vs-terminate), conditional re-run triggering, Gate node wired into every external-action edge — **verification precedes every external action**, no exceptions.
- **Recovery Policy Engine**: failure classification → ADVANCED root-cause estimation → policy-table strategy selection (deterministic, auditable): repair / retry+backoff / agent-swap / model-escalation / branch recompile / full replan / graceful degrade / ask-user / terminate. Loop-backs to Executor (22), Graph Compiler (23), Planner (24), Clarification (25), Synthesis-degrade (26). Safety self-healing (46). recovery_actions + verification_results tables live.
- **HumanApproval flow complete**: approval requests persisted, run pauses durably, `/approvals` API + expiry + decision audit.
- **run_outcomes ledger**: every run ends in an explicit verdict (completed_verified / rescued / escalated / failed / abandoned / degraded) — VACR/VADR become computable from this phase forward.

**Why its own phase:** this pair decides "sophisticated" vs "flaky" — the product thesis. It gets undivided attention and its own gate: every recovery strategy independently testable against injected failures.

**APIs after this phase:** `/runs/{id}/verification-results`, `/runs/{id}/recovery-actions`, `/runs/{id}/quality-gates`, `/runs/{id}/outcome`; `/approvals` list/detail/approve/reject; `/escalations`.
**What UI can start:** **Human Action Centre** (approvals, clarifications, escalations — real queues), **recovery history surface**, **verification detail in node inspector**, **workflow health (VACR) dashboard data**, failure/degraded UX states (doc 02 Part 18) against real degraded runs.

**Exit checks:** scoring correct on seeded good/bad outputs; all 9 recovery strategies fire correctly against their injected failure classes; approval pause survives restart and resumes on decision; degrade path produces honest partial flagged output; verdicts correct for every test-matrix run; false-pass rate measurable.

---

## Knowledge Phase — ADS, ADS Q, Memory, Policy, Drift

**Duration estimate:** 2.5 days
**What we build:**
- **ADS Core** (own cluster, own deployable): sources, documents + immutable versions, chunks (1024-dim + tsvector), structured records, memory namespace, permissions, provenance, freshness. Full ingestion pipeline: tenant resolution → validation → malware/content scan → normalization → dedup → permission assignment → provenance capture → chunking → indexing → versioning. Ingestion jobs with per-stage status. Upload path + first connectors (Shopify, Google Drive) via scheduled sync + webhooks.
- **ADS Q**: hybrid semantic+keyword retrieval, metadata filtering, reranking, context reconstruction, provenance + confidence scoring, tenant/workspace/project/workflow scoping, backpressure, retrieval audit.
- **ADS Client** goes from stub to real — Planner now plans with retrieved context (wire 2–3 complete).
- **Memory & Learning Service**: post-run extraction (STANDARD compression) → verified, scoped, versioned, reversible writeback — tenant/project knowledge → ADS memory namespace; operational learnings → Policy Store. Failure memory, global memory (anonymized, eval-gated), project memory, safety pattern learning.
- **Policy Store** (policy_db): versioned routing weights, thresholds, recovery preferences; promotion/rollback with eval gating; feedback wires into Selection & Binding (29) and Recovery (30).
- **Drift Detector**: scheduled re-evaluation, weight decay on stale performance, drift_scores.
- Right-to-delete execution across ADS + engine stores: deletion manifest → purge → verification → certificate → deletion ledger.

**Why now:** learning needs real execution + recovery outcomes to learn from (Execution and Self-Healing Phases provide them); planner upgrade from context-free to context-rich happens without any API change thanks to the Planning Phase stub.

**APIs after this phase:** `/ads/ingestion/uploads`, `/ads/ingestion/jobs/{id}`, `/ads/sources` + sync, `/ads/documents` + delete, `/ads/knowledge`; policy read surfaces; retrieval-test endpoint.
**What UI can start:** **Knowledge management surfaces** (sources, upload, ingestion status, chunk/index visibility, retrieval testing with provenance + confidence display, re-index, failed-doc views), **memory configuration surface**, **data export + right-to-delete flow**, provenance chips across run views.

**Exit checks:** upload → ingested → retrievable with correct provenance + tenant scoping; cross-tenant retrieval attempts = zero leakage; verified outcome writes back to correct destination; policy promotion measurably changes routing; drift detector flags simulated stale weight; deletion produces verifiable certificate; retrieval recall@10 measurable on golden set.

---

## Output Phase — Synthesis, Cost Ledger & Outcome Economics

**Duration estimate:** 1 day
**What we build:**
- **Synthesis Service**: merges N verified outputs into one coherent deliverable (ADVANCED); graceful-degradation assembly (honest partials, flagged, enumerated gaps); Synthesis node handler goes live.
- **Cost Ledger service** (cost_db): immutable cost_events ingest from all three gateways + sandbox + storage; per tenant/mode/workflow/project/run/node/provider/resource attribution; retry + recovery cost separation; internal vs billable vs margin; billing rollups; budget-threshold events.
- Pre-execution cost estimation endpoint (model/tool/sandbox/storage + expected retries + duration from historical run data).
- Full run: request → response with correct synthesis + accurate cost entry — the complete 38-wire pipeline is now closed.

**Why now:** last functional stop — depends on everything upstream existing; cheap phase because both components are narrow once their inputs are real.

**APIs after this phase:** `/costs/summary`, `/costs/by-run|by-workflow|by-project`, `/usage`, `/budgets`; estimation endpoint; synthesized final outputs in run results.
**What UI can start:** **Cost & usage dashboards**, **budgets UI**, **pre-execution estimation display** in creation flows, final-deliverable presentation views (incl. degraded-partial presentation).

**Exit checks:** end-to-end run produces correct synthesis; cost entry reconciles against provider usage within tolerance; degraded run presents flagged partial; budget breach emits event.

---

## Hardening Phase — Eval, Red-Team & Release Gate

**Duration estimate:** 2 days
**What we build:**
- **Eval & Red-team Harness** complete (eval_db): all 9 golden sets at launch-floor counts (planner 20, intent 30, retrieval 20, verification 20, recovery 15, injection 25, tenant-isolation 20, workflow-E2E 5, project-E2E 3); mock-testing utilities (tool-call capture, no live LLM); release-gate records; regression auto-add pipeline; red-team suites (injection, jailbreak, SSRF, upload, tenant-leak) running continuously.
- Eval thresholds driven to green (Test Plan §5): intent ≥95, planner ≥90, critical edges 100, recall ≥90, false-pass <2, recovery ≥90, injection block ≥98, leakage 0, unsafe action 0.
- Chaos suite (15 scenarios) to green; k6 load to SLO floors (100 ev/s, burst 500, p95s, 500 concurrent, 5k queued, zero loss/zero silent loss); backup/restore drill with deletion-ledger replay; Engine staging→prod promotion gate green.

**Why last in Engine track:** hardening something unproven is hardening the wrong thing; every earlier phase left its golden sets executable — this phase makes them law.

**APIs after this phase:** `/evaluations`, `/evaluation-runs`, `/benchmarks`, `/release-gates`; `/system/provider-health`, `/system/service-health`, `/system/degraded-capabilities`.
**What UI can start:** **Benchmarking console**, **provider/system health surfaces**, eval history views, admin evaluation management.

**Exit checks:** all thresholds green; chaos green; SLOs met; restore drill evidenced; Engine declared **backend-complete** — Platform backend track (doc 12) begins on this push.

---

## Engine Track Summary

| Phase | Builds | Days | Key UI unlock on push |
|---|---|---|---|
| Foundation | Contracts, infra, Temporal substrate | 2 | tokens, shell, typed client |
| Gateways | Model + Tool Gateways | 1.5 | cost-data contracts |
| Ingress | Session/Conversation/Event-Trigger ingress | 2 | triggers, conversations |
| Planning | Planner→Compiler pipeline | 2.5 | creation chat, canvas, plan review |
| Execution | Executor, sandbox, streaming | 2.5 | run timeline, terminal, build views |
| Self-Healing | Verification + Recovery | 2 | Human Action Centre, recovery UX |
| Knowledge | ADS/ADS Q, memory, policy | 2.5 | knowledge surfaces, deletion |
| Output | Synthesis + Cost Ledger | 1 | cost dashboards, estimation |
| Hardening | Eval, chaos, hardening | 2 | benchmarking, health |

**Total: ~18 engineering days of scope** — with 6 backend engineers parallel inside each phase, calendar ≈ 9–11 days. All 72 Engine features land across the nine phases; traceability per feature ID maintained in the ticket board.
