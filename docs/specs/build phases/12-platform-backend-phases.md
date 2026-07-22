# Alter Platform — Backend Build Phases

**Version:** 1.0
**Date:** 2026-07-22
**Sequence position:** Track 2. Begins on the Engine Hardening Phase push (Engine backend-complete). Same rhythm: each phase ends with a git push to `main` passing the merge gate; UI developers begin the listed surfaces the moment that push lands.

**Phase naming:** plain names are canonical. (Earlier drafts coded these P1–P7; mapping: Identity=P1, Product Core=P2, Connections=P3, Money=P4, Marketplace=P5, Engagement=P6, Operations=P7.)
**Derived from:** Platform Architecture (doc 02), API Spec (05), Data Model (04), Test Plan (08).

The Platform backend is the NestJS `platform-api` (Fargate, ap-south-1) + `platform-workers` (Temporal `platform` namespace) + marketplace/search/notification/billing domain services. It is the **only** caller of Engine, ADS, and providers — the browser and Next.js never reach them directly. Every phase here exposes REST (OpenAPI 3.1.1) that the UI consumes through the generated typed client; UI never shapes an API — contract changes require CEO approval.

---

## Identity Phase — Identity, Tenancy, Entitlements & Signup

**Duration estimate:** 2 days
**What we build:**
- Auth0 integration: Universal Login (email/password + Google), Organizations for tenants, session management (secure HttpOnly cookies, short-lived access + rotating refresh), MFA support, enterprise SSO (SAML/OIDC per tenant), device/session listing + revocation.
- Identity Broker: mints `X-Alter-Actor-Token` (5-min signed delegation JWT) for every platform-api → Engine call; service actors for background jobs.
- platform_db (RLS-enforced): tenants, workspaces, users, tenant_members, workspace_members, entitlements.
- **Public self-service signup flow**: email/phone verification → personal tenant + default workspace + free plan + limited credits, all limits config-driven (AppConfig + entitlements — 3 workflows, 1 project, 10 runs/day, 1 concurrent, 30 sandbox-min/mo, 500 MB ADS, 3 integrations; values changeable without code).
- RBAC engine: tenant roles (owner/admin/billing/member), workspace roles (admin/editor/operator/approver/viewer); server-side guards on every route; default-deny; cross-tenant CI tests.
- EntitlementProvider interface + internal adapter; abuse/fraud scoring hooks (rate limits, verification gates, purchase limits).
- Onboarding state machine (first-run wizard steps tracked server-side).

**Why first:** every subsequent Platform API needs an authenticated, tenant-scoped, role-checked actor. Free-tier limits and abuse controls must exist before anything is publicly reachable.

**APIs after this phase:** `/auth/*` session endpoints, `/tenants`, `/workspaces`, `/members`, `/entitlements`, `/onboarding`.
**What UI can start:** **Sign in/Sign up**, **onboarding wizard**, **workspace switcher**, **members & roles management**, **settings (profile, security, sessions, language)**, permission-denied states everywhere (real RBAC responses to design against).

**Exit checks:** stranger signs up → verified → lands in own workspace with enforced free-tier limits; role matrix enforced per route; cross-tenant access tests green; actor token validated end-to-end against Engine.

---

## Product Core Phase — Mode Domain APIs, Streaming Gateway & Human Action Centre

**Duration estimate:** 2.5 days
**What we build:**
- **Workflow domain service**: BFF orchestration over Engine workflow APIs — create (goal text → Engine conversation → draft DAG), canvas save (draft DAG with `metadata.ui.*`), validate/compile/simulate/activate/pause/resume/rollback, version listing, environment promotion, trigger management proxy (create/test/enable), template variables (typed, validated, versioned).
- **Project domain service**: brief submission, clarification relay, plan review actions, build start, repository views (via Engine + RepositoryProvider), environment variables (refs, masked), deployment actions with intelligent-routing recommendation relay, maintenance change-requests, handoff/export.
- **Run experience service**: run lists (cross-mode filters), run detail aggregation (nodes + verification + recovery + cost per node), artifacts with signed download URLs.
- **Human Action Centre service**: unified queues (approvals + clarifications + escalations), claim/decide/annotate, assignment, expiry handling.
- **Streaming Gateway**: SSE fan-out to browser — subscribes Engine streams, re-envelopes with per-tab multiplexing, `Last-Event-ID` resume, heartbeats, auth revalidation on reconnect + permission change, coalescing backpressure. Terminal stream relay (xterm-ready frames).
- Idempotency-key store; ETag/If-Match concurrency on PATCH routes.

**Why now:** this is the core product loop for both modes — everything the daily user touches. Engine is complete, so these are thin, honest projections with zero mocked behavior.

**APIs after this phase:** `/workflows/*` full, `/projects/*` full, `/runs/*` full, `/approvals`, `/escalations`, `/stream/*` SSE endpoints, `/artifacts`.
**What UI can start:** the big wave — **workflow list, creation chat, visual canvas (full round-trip), workflow review, simulation, activation, run timeline, node inspector, recovery history, versions**; **project list, brief, plan review, build progress, file tree, code-change view, terminal stream, test results, audit report, preview, deployment, repository, env vars, maintenance, handoff**; **Human Action Centre**; **run history**; **dashboard** (real aggregates).

**Exit checks:** both mode flows end-to-end through platform-api only (no direct Engine calls anywhere); SSE survives refresh + permission revocation closes stream; canvas round-trip through the BFF proven; approval decision resumes paused run.

---

## Connections Phase — Integrations, Credentials, Knowledge & Channels

**Duration estimate:** 2 days
**What we build:**
- **Integration Hub**: connector catalog (capability-declared), OAuth flows (GitHub App, Google, LinkedIn, X, Slack, HubSpot, Salesforce, Shopify, Zendesk, M365 — launch subset per catalog priority), connection health monitoring, scope display + revocation, per-workspace binding.
- **Credential Vault service**: credential references CRUD (values write-only via SecretsProvider, masked display, scoped permissions, use-audit), `/integrations/{id}/actions/test`.
- **Knowledge management service**: ADS administration relay — sources (create/sync), uploads (signed URL flow → ingestion job), job status, document listing, retrieval testing (query → results + provenance + confidence), re-index, permissions, retention config, deletion requests.
- **Channel services**: WhatsApp (account connection, template management, test sends, conversation monitoring config, media, escalation rules), Voice (Exotel/Twilio number binding, language/voice-style config via capability-based requests), media config APIs (image gen, Sarvam/Polly TTS, Sarvam/Transcribe STT).
- Trigger ↔ integration binding (webhook endpoints generated per integration, secrets rotated).

**Why now:** workflows are creatable (Product Core Phase) but only useful once connected to the outside world; this phase turns the product from self-contained to operational.

**APIs after this phase:** `/integrations/*`, `/credentials/*`, `/ads/*` (management surface), `/channels/whatsapp/*`, `/channels/voice/*`, `/media/*`.
**What UI can start:** **Integrations surface** (catalog, connect flows, health), **credential vault UI**, **knowledge surfaces** (sources, upload, ingestion status, retrieval test, memory config), **WhatsApp channel management**, **voice channel config**, **data export / right-to-delete flow**.

**Exit checks:** OAuth round-trips for launch connectors; credential never appears in any response or log; upload → ADS ingestion → retrieval test with provenance; WhatsApp template test-send succeeds; deletion request produces certificate.

---

## Money Phase — Billing, Cost Experience & Budgets

**Duration estimate:** 1.5 days
**What we build:**
- **BillingProvider + RazorpayAdapter**: subscription plans (free/paid tiers), payment-method-on-file, invoices, upgrade/downgrade, overage billing, webhook handling (payment events → entitlement updates); StripeAdapter stub behind same interface (activates on India approval).
- **Cost experience service**: tenant/workspace/workflow/project/run cost views (Engine Cost Ledger projections), spending dashboard aggregates (by provider/model/user), forecasts, internal-vs-billable-vs-margin (admin-visible only), pre-execution estimation relay.
- **Budget service**: caps + alert thresholds per workspace/workflow/project, enforcement wiring (budget breach → run gating per policy), notification triggers.
- Suspension/dunning state machine for failed payments (grace → limited → suspended, all config-driven).

**Why now:** signup (Identity Phase) created free users; before marketplace commerce (Marketplace Phase) opens, subscription billing and budget enforcement must be real or costs run unmetered.

**APIs after this phase:** `/billing/plans|subscription|invoices|payment-methods`, `/costs/*` (customer-facing), `/budgets`, estimation endpoints.
**What UI can start:** **Cost & usage dashboards**, **budgets UI**, **self-serve billing (plans, upgrade, invoices, payment method)**, **pre-execution cost estimation** in creation flows.

**Exit checks:** sandbox subscription purchase → entitlement upgrade live; budget breach gates a run + notifies; invoice math reconciles with Cost Ledger; failed-payment path suspends per state machine.

---

## Marketplace Phase — Marketplace, Publishers & Tool Registry

**Duration estimate:** 2.5 days
**What we build:**
- **Marketplace service** (marketplace_db): listings (workflow templates, project templates, agents, tools) with versions + compatibility declarations (DAG schema, node types, connector capabilities, entitlements), install flow (compatibility check → permission display → explicit approval → tenant copy), licensing (single-workspace/tenant-wide, machine-readable, install-enforced), ratings/reviews (verified-install only), orders.
- **Publisher & Payout service**: publisher verification (tenant verification → KYC → tax → bank → marketplace agreement), publishing pipeline state machine (`draft → private testing → submitted → automated review → human review → published → suspended/deprecated/removed`), Razorpay Route split settlement (80/20, taxes + fees pre-settlement), payout ledger, earnings views.
- **Community Tool Registry**: tool/MCP manifests, capability declarations, trust levels (Alter Verified / Verified Publisher / Community Reviewed / Unverified Private / Blocked), automated scanning jobs (package + malware, executed in `alter-sandbox-exec`), version pinning, revocation kill-switch propagating to installed tenants.
- **Search service**: Postgres FTS (tsvector weighted fields + trigram fuzzy) across listings, templates, agents, tools, docs — behind SearchProvider.
- Curated first-party catalog seeded (Alter-published templates/agents).

**Why now:** commerce rails (Money Phase) exist; marketplace is the largest independent Platform domain and the highest-risk public surface — it gets its own phase with the review pipeline built before any third-party asset can reach a tenant.

**APIs after this phase:** `/marketplace/*` (browse/search/detail/install/purchase), `/publisher/*` (KYC, listings, versions, earnings, payouts), `/registry/*` (tools, trust, revocation), `/search`.
**What UI can start:** **Marketplace home/browse/search, listing detail (permissions + trust badges), install/purchase flow, my-assets, reviews**; **seller console (KYC, listings, publish pipeline, earnings, payouts)**; **template publishing flow** from Workflow Mode; **global search**.

**Exit checks:** publish → automated scan → human review → live → install → paid order → Route split settles (test mode); incompatible asset blocked with explanation; revocation propagates to installed tenant with notification; malicious seeded package caught by scan.

---

## Engagement Phase — Notifications, Discovery, Benchmarking & Platform Jobs

**Duration estimate:** 1.5 days
**What we build:**
- **Notification service**: in-app centre (unread, categories, severity, deep links, acknowledgement, escalation), preference matrix (per event class × channel), SES email templates (workflow/project/deployment/approval/budget/system events), digest batching.
- **Platform Jobs** (`platform` Temporal namespace, platform-workers): ingestion coordination, exports, marketplace review pipeline execution, notification fan-out, connector syncs, repository sync, deployment monitoring, billing rollups, cleanup/retention enforcement — all behind DurableJobProvider; browser-refresh-proof.
- **Use-case Discovery service**: pattern analysis over authorized data only (ADS content/metadata, run history, repeated approvals/interventions, connector activity) → ranked recommendations (problem, evidence, value, effort, integrations, risk, confidence) → one-click draft workflow/project creation (never auto-activates).
- **Benchmarking service**: agent/model/provider comparison views over eval_db, eval history, configuration promote/rollback relays.
- **Localization backend**: translation bundle serving (EN+HI), user + workspace language preference, localized email/notification rendering.

**Why now:** all producers of notification-worthy events now exist; discovery needs real run history + ADS content; benchmarking needs the eval harness — all satisfied by prior phases.

**APIs after this phase:** `/notifications` + preferences, `/discovery/recommendations` + accept-to-draft, `/benchmarks/*`, `/i18n/bundles`.
**What UI can start:** **Notification centre + preferences**, **use-case discovery surface**, **benchmarking console**, **Unified Command Experience** completion (⌘K actions now have full API coverage), HI localization pass across shipped surfaces.

**Exit checks:** event classes fan out per preference matrix; discovery recommendation → draft workflow with evidence attached; digest batching correct; HI bundle renders in notification + email templates.

---

## Operations Phase — Admin Plane, Audit, CLI & Platform Hardening (release gate)

**Duration estimate:** 2 days
**What we build:**
- **Admin & Operator Console APIs** (separate admin plane — staff never members of customer tenants): tenant administration (provisioning, suspension, entitlement overrides), JIT support access (scoped grants, reason codes, time limits, customer-visible), provider management (health, activation, fallback control), incident management (+ status-page publishing with human approval), policy management (flags, entitlements, model policies), billing operations (refunds, disputes, plan overrides), abuse & security review (fraud scores, free-tier abuse queues, marketplace takedowns), audit explorer (admin + customer-scoped views), deployment administration, marketplace governance queues.
- **Support-access consent surface data** (customer side): active/past grants visible to tenant admins.
- **`alter` CLI backend contract**: token exchange for CLI auth (device flow), stable versioned API subset (login, workspaces, workflows list/run, runs watch via SSE, projects build, approvals, logs tail, deploy status, doctor), version-skew warnings.
- **Platform hardening to release gate**: Platform-specific chaos (Engine outage → degraded UX correctness, provider outage banners, SSE storm, payment webhook replay), k6 on Platform endpoints (p95 <300ms), red-team (CSRF/XSS/CSP validation, upload abuse, RLS bypass, marketplace supply-chain), full cross-system UAT per Test Plan §10, staging→prod gates green.

**Why last:** admin/audit surfaces span every domain — they need everything else to exist; hardening is the final gate before the production cut (doc 09 §6 runbook executes on this push).

**APIs after this phase:** `/admin/*` full suite, `/audit-events` (customer + admin scopes), `/support-access`, CLI device-flow endpoints, `/system/*` health relays.
**What UI can start:** **all 12 admin/operator surfaces**, **customer audit view + support-access consent view**, **system status embed**; CLI ships (thin client, no UI dependency).

**Exit checks:** JIT grant → scoped access → auto-expiry → customer-visible audit trail; every admin action hash-chained; Platform promotion gates green; cross-system UAT signed; production go/no-go per Deploy Checklist.

---

## Platform Track Summary

| Phase | Builds | Days | Key UI unlock on push |
|---|---|---|---|
| Identity | Identity, tenancy, signup, RBAC, entitlements | 2 | auth, onboarding, members, settings |
| Product Core | Mode domain APIs + SSE gateway + HAC | 2.5 | canvas, studios, timelines, HAC — biggest wave |
| Connections | Integrations, credentials, knowledge, channels | 2 | integrations, knowledge, WhatsApp/voice |
| Money | Billing, costs, budgets | 1.5 | billing, cost dashboards, estimation |
| Marketplace | Marketplace, publishers, tool registry, search | 2.5 | marketplace, seller console, search |
| Engagement | Notifications, discovery, benchmarking, jobs | 1.5 | notification centre, discovery, ⌘K |
| Operations | Admin plane, audit, CLI, hardening | 2 | admin surfaces, audit, status |

**Total: ~14 engineering days of scope** — parallelized across the backend team, calendar ≈ 7–9 days after the Engine Hardening Phase.

## UI Trailing Rule (both tracks)

1. UI work on a surface begins only after its enabling phase's push lands on `main` — the OpenAPI diff in that push is the UI team's work order.
2. UI consumes the generated typed client exclusively; CI architecture-boundary check fails any other import path.
3. UI-discovered API gaps are filed as tickets to the owning backend phase team — UI never patches around a contract.
4. Every surface ships with all six states (loading/empty/error/degraded/permission-denied/success) using the real error codes and degraded signals that phase exposes.
5. From the Foundation Phase push the UI team is never idle: tokens → shell → components → mock-served skeletons → then real surfaces in phase order above.

## Combined Calendar Reality

Engine ~9–11 days + Platform ~7–9 days serial = **16–20 calendar days of backend before Platform backend completes**. Against the Aug 2 deadline (11 days), this sequencing means either (a) the deadline moves, or (b) Engine and Platform backend phases overlap partially (the Identity Phase can start once the Engine's Foundation, Gateways and Ingress Phases land, since it depends only on contracts + ingress), or (c) Aug 2 ships with later Platform phases (the Marketplace, Engagement and Operations Phases) flag-dark. This is a product-owner decision — the phase structure supports all three without redesign; option (b) recovers most of the parallelism while preserving strict backend-before-UI per phase.
