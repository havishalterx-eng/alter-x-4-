# Alter — Product Requirements Document (PRD)

**Version:** 1.0
**Date:** 2026-07-21
**Owner:** Havish Vardhan (product direction, architecture, final approval)
**Status:** Approved baseline — supersedes all prior Alter planning documents. Feature/component set may still be redesigned during the remaining spec Q&A; the final approved set is binding.

---

## 1. Problem Statement

Businesses can access powerful AI models, but they cannot trust them to run important processes autonomously. The failure is not in any single model — it is in the absence of an execution system around the models.

**Concrete trigger case:** A customer inquiry arrives through WhatsApp. The AI must understand the request, check company data, determine product availability, prepare a response or quotation, update the relevant system, and trigger the next action. Each individual step is achievable. The workflow fails when the steps must operate together: one agent misunderstands the request, another uses outdated context, an API times out, a tool returns malformed data, the next agent continues without noticing, and the final response looks convincing but is based on incomplete execution.

Missing from every existing option:

- Durable state
- Reliable verification of outputs
- Controlled retry and intelligent escalation
- Awareness of what has already failed
- Safe resumption from the point of failure

Human operators must inspect the whole workflow manually, find the break, and restart from zero.

**The gap:** automation tools (n8n, Zapier) move data through predefined steps but have no intelligence; agent frameworks (LangGraph, CrewAI) demonstrate intelligence but have no reliability layer; AI app builders (Lovable) generate software but do not test, repair, deploy, or maintain it. None handle the combination of ambiguity, changing context, unreliable models, external-system failures, quality control, recovery, memory, and long-running execution.

Alter Engine is the control and reliability layer that closes this execution gap: it turns an uncertain user goal into a governed, observable, and recoverable execution process. It plans the work, binds the right intelligence and tools, preserves state, verifies every meaningful output, detects failure, selects a recovery strategy, and continues without losing the run.

The 30-component architecture exists because production reliability requires clear ownership of separate failure domains — planning, execution, verification, recovery, memory, security, model access, tool access, and cost control cannot be one large agent prompt.

---

## 2. Product Definition

**Alter is a robust autonomous execution platform with two modes, both powered by one shared Engine.**

### 2.1 Workflow Mode

Creates, maintains, and executes long-running business workflows.

Example workloads: WhatsApp-led sales and support automation, lead qualification, customer support, database operations, reporting, scheduled and event-driven automation, cross-system business processes, order and inventory coordination, customer onboarding, document processing.

**Primary competitor:** n8n.
**Win statement:** *Unlike n8n, Alter does not only execute a workflow you manually design — it understands the objective, creates the workflow, maintains it, verifies its results, and repairs it when models, tools, or APIs fail.*

### 2.2 Project Mode

Builds and ships complete software projects.

Example deliverables: websites, web applications, internal business tools, SaaS products, APIs, mobile-ready applications, supporting backend systems.

**Primary competitor:** Lovable.
**Win statement:** *Unlike Lovable, Alter does not stop at generating an application — it plans, builds, tests, audits, repairs, deploys, and continues maintaining the project through a durable multi-agent execution system.*

### 2.3 Overall Positioning

*Unlike products that either automate workflows or generate applications, Alter operates in both modes: it autonomously runs and maintains business operations, and it builds, verifies, and ships complete software projects.* The long-term objective is category definition — making separate automation tools, agent frameworks, and AI app builders increasingly unnecessary.

"Market killer" means better verified outcomes, not more features: fewer silent failures, higher autonomous completion, faster recovery, stronger production readiness, one system for both operational workflows and software delivery, and deep switching costs once embedded in business operations.

### 2.4 Architecture Identity (summary — full detail in Tech Spec)

- **Engine:** headless, deterministic-control-plane core. Hybrid architecture: durable-execution substrate + graph-native node executor + microkernel policy injection, wrapped in cross-cutting planes.
- **Platform:** web application shell — the only customer-facing surface in v1. Communicates with the Engine exclusively through private, versioned internal APIs so the Engine stays decoupled and embeddable later.
- Candidate capability set: 72 features (62 core + 10 market-leading additions) across 30 components. This set may be merged, redesigned, or replaced during spec finalization; the final approved set is the build contract.

---

## 3. Target Users

**Primary v1 customer:** operations and transformation teams inside businesses that have a real process to automate and cannot afford silent failure — served as **managed clients** (Alter-managed, customer-configured), not self-service users.

**Secondary v1 beneficiary (Project Mode):** businesses needing complete software delivered and maintained autonomously.

Explicitly **not** v1 users: individual consumers, external developers (no public API), self-service no-code builders, open-source community.

**Access model v1:** customers touch Alter only through the Alter Platform. Engine APIs are internally API-driven but private. Public API keys, SDKs, external embedding, and developer documentation arrive in a later release, after authentication, authorization, quotas, billing, versioning, and docs are production-ready.

---

## 4. Success Metrics

Both modes are judged on **verified outcomes, not generated output volume**. Measurement requires a per-run outcome ledger (verdict: completed-verified / rescued / escalated / failed / abandoned) from day one. Denominators include failed, abandoned, and escalated runs — the metric cannot be gamed. Measured only on workflows/projects past onboarding, testing, and production approval.

### 4.1 Workflow Mode — North Star

**Verified Autonomous Completion Rate (VACR): ≥ 85%** over a rolling 30-day window.

A run counts as complete only when: workflow completes end-to-end, correct business outcome achieved, no human rescue, all quality and safety gates passed, no critical external error.

**Guardrail (non-negotiable):** critical customer-visible error rate **< 0.1%** — fewer than 1 critical incorrect external action (message sent, record modified, transaction approved, action triggered) per 1,000 runs.

### 4.2 Project Mode — North Star

**Verified Autonomous Delivery Rate (VADR): ≥ 80% (v1), ≥ 90% (mature).**

A delivery counts only when: project generated, builds successfully, tests pass, renders correctly, no placeholder or broken boilerplate, security and architecture checks pass, deploys successfully, core acceptance criteria pass, no human code repair required.

**Guardrails:**

- Deployment success ≥ 95%
- Build and render verification 100% before delivery
- Critical security defects at delivery: 0
- Human repair required after "complete" status: < 20% in v1

---

## 5. Scope

### 5.1 In Scope (v1)

- All approved core Engine capabilities (final set fixed at end of spec Q&A; candidate pool = 72 features / 30 components)
- Workflow Mode and Project Mode, both first-class on day one
- Alter Platform web application (two distinct UX surfaces, one per mode)
- Private Platform-to-Engine versioned API communication
- Managed connectors required for initial client workflows (WhatsApp and related business systems)
- Sandbox-based code generation and execution (E2B) — core, not peripheral
- Verification, recovery, memory, self-learning policy updates, observability, audit logging, and cost tracking
- Multi-tenant isolation
- Production deployment and ongoing maintenance
- Event-triggered and scheduled workflow execution in addition to user-initiated goals
- Human approval / handoff as a core workflow construct

### 5.2 Out of Scope (v1)

> **AMENDED 2026-07-22:** The items struck below are superseded by the Platform Architecture decision (doc 02): public marketplace, community connector ecosystem, third-party plugin monetization, and public no-code self-service onboarding are now **IN scope for v1** and live by Aug 2, together with public self-service signup, free tier, and paid marketplace (Razorpay primary, 80/20 revenue share). The remaining exclusions below still stand.

- Public API access, customer-issued API keys, external developer access, third-party embedding, public SDKs and API documentation
- Cross-language agent interoperability beyond the primary stack
- Native iOS/Android Platform apps
- On-premise or self-hosted customer deployment
- Customer-authored custom node runtime
- Public marketplace, community connector ecosystem, third-party plugin monetization
- White-label Platform
- Public no-code self-service onboarding
- Consumer use cases
- Open-source edition
- Multi-cloud active-active deployment
- Full enterprise procurement features (SCIM, custom legal policies, dedicated support portals)

---

## 6. Commercial Model

**Day one: managed-service retainer + usage billing.**

Each client pays:

1. Monthly platform and management retainer (predictable revenue; covers setup, monitoring, support)
2. Usage charges — models, tools, sandbox compute, storage, workflow execution — with margin over underlying infrastructure and model cost
3. One-time implementation fee for custom workflows or projects

**Primary billing unit:** verified completed workflow run or verified project delivery, plus underlying usage.

**Cost Ledger must attribute cost by:** tenant, mode, project/workflow, run, node, model/provider, tool/API, sandbox compute, storage, retries and recovery cost — and separate internal cost vs. customer-billable cost vs. margin.

**Later:** standard subscription tiers with included usage, overage pricing, enterprise contracts, Project Mode delivery packages.

---

## 7. Timeline and Delivery Model

**Deadline: August 2, 2026 — non-negotiable internal deadline.**

Target state on Aug 2: **full production build** — the complete approved capability set implemented and operational. Not a demo, not an alpha, not a single narrow workflow. Specifically:

- All approved features implemented; all required components operational
- Full Engine pipeline end-to-end: planner, compiler, executor, verification, recovery, memory, gateways, sandbox — integrated
- Multi-tenant isolation active; real model and tool integrations
- Self-healing and self-learning policy updates operational
- Observability, audit logs, and cost tracking active
- Platform connected to Engine APIs; production deployment completed
- Core tests and code audits passed

**Accepted risk:** this creates extreme delivery risk. The plan optimizes for maximum parallelism, rapid integration, and zero unnecessary scope expansion. No public claim that the complete platform is finished by that date.

### 7.1 Team

- **Product/architecture owner:** Havish — direction, scope, sequencing, final technical approval
- **Backend:** owner + engineering teammates, small-team assumption
- **UI/UX teammate:** owns product design, workflows, interaction states, design system; Platform frontend implementation ownership must be explicitly assigned to one engineer (design ownership alone is insufficient)

### 7.2 Execution Model (three AI sessions)

1. **Claude Code — CEO Session:** architecture, scope, sequencing, dependencies, task allocation, integration decisions; generates master prompts per implementation stage from the final approved build plan. The old Phase 0–7 plan is not reused unless explicitly re-approved.
2. **Codex — Code Writer Session:** implements components, integrations, tests, fixes from CEO master prompts; never independently changes scope or design.
3. **Codex — Code Audit Session:** independent review for correctness, security, architectural compliance, performance, test coverage, regressions, production readiness. Compiling is not approval.

**Definition of done per component:** implementation → independent audit → testing → CEO-session approval. Writer and auditor stay separate sessions.

### 7.3 Delivery Principles

- Team works in parallel by subsystem; contracts defined first so parallel tracks do not collide
- Daily integration, testing, and architecture audits
- No long documentation or planning cycles after specifications lock
- Reuse mature managed services everywhere (e.g., Temporal Cloud, managed auth, E2B, managed observability); never build commodity infrastructure from scratch
- Shared private repository, protected main branch, subsystem ownership, mandatory review before merge
- AI agents are force multipliers; they do not replace architecture ownership, security review, or production validation

---

## 8. Key Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Full capability set in 12 days | Very high — headline risk | Max parallelism; managed services only; contracts-first; daily integration; audit gate per component; scope expansion frozen |
| Two modes, two UX surfaces, one deadline | High | Shared Engine core serves both; mode differences isolated to Platform surface + node-type mix |
| Silent failure reaching customers | Critical (guardrail breach) | Verification before every external action; no-silent-failure rule; escalation + human handoff paths |
| Cost blowout on model usage | Medium | Cost Ledger from day one; semantic cache; tiered model routing |
| Small team + AI sessions drift from architecture | Medium | CEO session as single source of sequencing; writer/auditor separation; mandatory merge review |

---

## 9. Open Items (feed into next spec documents)

1. **Final capability set decision** — include/remove/add against the 72-feature, 30-component candidate pool. Decided at end of full Q&A cycle.
2. **Event ingestion ownership** — v1 workloads are event-triggered (message arrives, order lands); current component list has no owner for triggers/standing workflows. Must be assigned in Tech Spec.
3. **First managed client identity and concrete first workflows** — named client(s), integrations list, escalation staffing. Needed for Deploy Checklist.
4. **Platform frontend implementation owner** — must be explicitly assigned.
