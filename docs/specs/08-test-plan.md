# Alter — Test Plan

**Version:** 1.0
**Date:** 2026-07-22
**Status:** Approved baseline. All numeric targets are configurable v1 release floors — configuration-driven, per-environment/per-tenant adjustable, changeable without core-Engine rewrites, revalidated by load/stress/chaos before every promotion. Not the product's scale ceiling.

---

## 1. Test Layers & Tooling

| Layer | TS | Python | Shared |
|---|---|---|---|
| Unit | Vitest | Pytest + Hypothesis | — |
| API/service | Supertest | FastAPI test client | Testcontainers |
| Contract | schema-based contract tests from `packages/contracts` | same | every service boundary + every provider adapter |
| Integration | Testcontainers stacks (Postgres+pgvector, Redis, LocalStack, Temporal dev server) | same | disposable per-PR CI environments |
| E2E | Playwright (Platform + generated apps) | — | full-pipeline scenarios via golden sets |
| Load | — | — | k6 |
| Chaos | — | — | failure-injection harness (release blocker) |
| LLM eval | — | — | Eval & Red-team Harness + Langfuse tracking |

Mock-testing rule (feature 55): tool calls captured, flows validated without live LLM endpoints; mock adapters implement identical Alter interfaces as production.

---

## 2. Coverage Floors

| Scope | Floor |
|---|---|
| Control-plane services | ≥80% line, ≥75% branch |
| Security-critical services (auth, tenant isolation, Model Gateway, Tool Gateway, Event & Trigger Gateway, deletion/governance) | ≥90% line |
| Core workflow/compiler/recovery logic | ≥85% branch |
| Provider adapters | 100% canonical contract-test coverage |
| Intelligence services | ≥70% line **+ mandatory eval thresholds (§5)** |

Coverage never substitutes for eval quality — intelligence correctness is proven by golden sets, not line counts.

---

## 3. Merge Gate (every PR — no direct merge to `main`)

1. Formatting/lint
2. Type checking
3. Unit tests
4. Contract tests
5. Affected-service integration tests
6. Database migration validation
7. Cross-tenant isolation tests
8. Secret scanning
9. Dependency/security scanning
10. Architecture-boundary checks (no vendor SDK outside adapters; no cross-database joins)
11. Codex Code Audit session approval (independent — compiling is not approval)
12. Required human reviewer approval

---

## 4. Promotion Gates

**dev → staging:** full integration suite · golden-set eval pass · provider-adapter contract suite · database migration test · build + artifact verification · zero unresolved critical/high audit findings.

**staging → prod:** full E2E suite · red-team suite · load/SLO test (§6) · chaos test (§7) · backup/restore test · canary deployment with verified automatic rollback · subsystem-owner approvals · Claude CEO session review · final human go/no-go (product owner).

---

## 5. Golden Sets & Eval Thresholds

Launch-floor sets (grow forever; every real defect auto-adds a regression case):

| # | Set | Cases |
|---|---|---|
| 1 | Planner decomposition | 20 |
| 2 | Intent/mode classification | 30 |
| 3 | ADS retrieval quality | 20 |
| 4 | Verification scoring (good/bad pairs) | 20 |
| 5 | Recovery strategy (injected failures) | 15 |
| 6 | Safety / prompt injection | 25 |
| 7 | Tenant-isolation attempts | 20 |
| 8 | Workflow Mode E2E scenarios | 5 |
| 9 | Project Mode E2E builds | 3 |

Authorship: architecture/product cases — product owner; subsystem cases — owning engineers; adversarial cases — Code Audit session; regression cases — automatic post-defect; final acceptance — CEO session + human review.

**Release thresholds (hard gates):**

- Intent classification ≥95%
- Planner valid-DAG generation ≥90%
- Dependency correctness on critical edges: 100%
- Retrieval recall@10 ≥90%
- Verification false-pass rate <2%
- Recovery strategy correctness ≥90%
- Prompt-injection block rate ≥98%
- Cross-tenant leakage: **0**
- Critical unsafe external action: **0**

---

## 6. Load / SLO Targets (k6 — v1 production floor)

- Event ingestion: 100 events/s sustained; burst 500 events/s for 5 min
- API read/control: p95 <300 ms, p99 <1 s (long model/tool execution excluded from API latency, fully traced)
- Run-start latency: p95 <2 s
- Event → Temporal signal/start: p95 <1 s
- SSE update delay: p95 <1 s
- Webhook acknowledgement: p95 <500 ms
- Concurrent active runs: 500; queued runs: 5,000 with zero loss
- Availability: 99.9%
- Duplicate event execution: 0 · Silent run loss: 0

All throughput/concurrency/queue/timeout/retry/scaling thresholds are configuration-driven and horizontally scalable; raising limits must never require changing core contracts or execution logic.

---

## 7. Chaos & Failure Injection (production release blocker)

Mandatory scenarios:

kill Temporal worker mid-run · restart worker during recovery · primary model provider unavailable · provider timeout/latency spike · malformed/poisoned tool response · Redis flush · duplicate webhook · out-of-order conversation events · SQS redelivery · database connection interruption · sandbox crash · browser session failure · deployment provider failure · partial ADS outage · invalid secret rotation.

Pass conditions for every scenario:

- No silent failure
- No duplicate irreversible action
- Durable resume works
- Correct retry / fallback / escalation
- User/operator sees degraded state
- Complete trace + audit record
- Recovery never crosses tenant boundaries

---

## 8. Provider-Swap Testing (plug-and-play proof)

Per provider category: canonical Alter contract suite · primary adapter test · mock adapter test · fallback adapter test · provider-swap test · failure-mode test · capability-downgrade detection · migration/rollback validation.

**A provider is not "replaceable" until the swap is tested.**

---

## 9. Security & Red-Team (continuous)

Suites: injection, jailbreak, SSRF, upload abuse, tenant-leak attempts (mapped to golden sets 6–7 plus infrastructure attacks). Runs continuously against the Engine itself (feature G8) and as a staging→prod gate. RLS bypass attempts and break-glass audit verification included in CI cross-tenant tests.

---

## 10. Human UAT (before Aug 2 go-live)

- Each subsystem owner signs their service/domain
- Workflow Mode owner signs end-to-end business workflows
- Project Mode owner signs build/test/deploy lifecycle
- Security owner signs tenant isolation + attack tests
- Platform owner signs UI/API flows
- **One cross-system UAT run by the full team** — no owner self-certifies in isolation; the complete cross-mode system passes shared UAT
- Product owner gives final product + production approval

---

## 11. Definition of Done (per component — restated)

implementation → independent Code Audit → tests at all applicable layers passing → coverage + eval floors met → CEO-session approval. Merge and promotion gates enforce this mechanically; nothing ships on "it compiles."
