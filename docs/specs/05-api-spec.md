# Alter — API Specification

**Version:** 1.0
**Date:** 2026-07-21
**Status:** Approved baseline. The normative machine contract is the OpenAPI 3.1.1 document generated from `packages/contracts` and validated in CI; this document defines the rules and surface that contract must implement. No undocumented endpoint reaches production.
**Access:** Private. Platform-only in v1. No customer API keys, no public developer API.

---

## 1. Conventions

- **Style:** REST, OpenAPI 3.1.1 (kept forward-compatible with 3.2). Base path `/api/v1`; major version in URL; breaking changes require `/api/v2`; non-breaking additions stay under v1.
- **Schemas:** Alter-owned only. No Bedrock, Temporal, Auth0, Vercel, or E2B data types in any contract. Vendor IDs appear only as opaque external references. Adapters translate vendor payloads to canonical Alter resources.
- **IDs:** prefixed UUIDv7 strings (`wf_`, `run_`, `prj_`, ... per Data Model doc).
- **Status codes:** `201 Created` for resource creation; `202 Accepted` + operation/run `Location` for async commands; state transitions use explicit action endpoints.
- **Concurrency:** optimistic via `ETag` / `If-Match` on PATCH.
- **Tracing:** every request carries `traceparent`; every response includes `request_id` and `trace_id` headers.

## 2. Authentication

```
Authorization: Bearer <Auth0 M2M access token>       (client-credentials flow)
X-Alter-Actor-Token: <short-lived signed delegation JWT>
```

- **M2M token** proves calling-service identity and allowed Engine scopes.
- **Actor token** proves action context. Claims: `user_id, tenant_id, workspace_id, roles, permissions, session_id, auth_time, jti, iss, aud, iat, exp`. Signed by the Alter Identity Broker; max lifetime 5 minutes; Engine validates signature, issuer, audience, expiry, and `jti`; actor tenant scope must match the M2M organization scope.
- Never trust plain forwarded headers (`X-User-Id` etc.). No raw Auth0 profile forwarding. Background jobs, webhooks, schedulers, and recovery flows use **service actors** — never fabricated human actors.

## 3. Error Envelope — RFC 9457

`application/problem+json`:

```json
{
  "type": "https://errors.alter.ai/workflow/invalid-state",
  "title": "Workflow state conflict",
  "status": 409,
  "detail": "The workflow cannot be activated while validation is pending.",
  "instance": "/api/v1/workflows/wf_x/actions/activate",
  "error_code": "WORKFLOW_INVALID_STATE",
  "trace_id": "trc_x",
  "request_id": "req_x",
  "retryable": false,
  "field_errors": [],
  "documentation_key": "workflow.invalid-state"
}
```

Never exposed: `tenant_id`, stack traces, SQL errors, provider secrets, internal service names, raw model/provider responses.

## 4. Streaming — SSE (v1)

```
GET /api/v1/runs/{run_id}/stream
GET /api/v1/projects/{project_id}/builds/{run_id}/stream
```

Carries: run progress, node state changes, project build progress, model output streaming, recovery events, clarification requests, approval requests, deployment status, verification results.

Requirements: event IDs + ordered sequence numbers; resume via `Last-Event-ID`; heartbeats; reconnect support; authorization revalidation on reconnect; backpressure controls. **The stream is never the system of record** — state endpoints remain authoritative.

Event types (envelope `{seq, event, run_id, ts, data}`):

```
run.status  node.started  node.completed  node.failed
model.delta  verification.result  recovery.action
clarification.requested  approval.requested
deployment.status  run.degraded  run.completed
```

WebSocket deferred to genuinely bidirectional features (collaborative editing, presence, interactive terminals).

## 5. Pagination — cursor only

```
GET /api/v1/runs?cursor=<opaque>&limit=50
→ { "data": [...], "page": { "next_cursor": "...", "has_more": true, "limit": 50 } }
```

Cursor opaque and signed; ordering stable and deterministic; filters/sorts bound into cursor integrity; default limit 50, max 200; no offset pagination in production; separate continuation tokens for large event streams.

## 6. Idempotency

All mutation commands accept `Idempotency-Key`. Windows: standard mutations 24h; workflow/project execution starts 7 days; webhook events per event policy (provider event ID); financial/irreversible operations configurable longer.

Stored: tenant, actor, endpoint, key, normalized request hash, status, response reference, created/expiry. Semantics: same key + same request → original result replayed; same key + different payload → `409 IDEMPOTENCY_KEY_REUSED`; concurrent duplicates collapse into one operation.

---

## 7. Resource Surface (v1)

### 7.1 Workflow Mode

```
POST   /workflows                          create (goal text or definition draft)
GET    /workflows            /workflows/{id}
PATCH  /workflows/{id}                     (If-Match)
GET    /workflows/{id}/versions            immutable version list
POST   /workflows/{id}/actions/compile     202 → compile run
POST   /workflows/{id}/actions/simulate    dry-run against test inputs
POST   /workflows/{id}/actions/activate
POST   /workflows/{id}/actions/pause
POST   /workflows/{id}/actions/resume
POST   /workflows/{id}/actions/rollback    { target_version }
```

### 7.2 Project Mode

```
POST   /projects                           create (brief)
GET    /projects             /projects/{id}
GET    /projects/{id}/versions
GET    /projects/{id}/repository           binding info
POST   /projects/{id}/builds               202 → build run
GET    /projects/{id}/builds               build run list
GET    /projects/{id}/tests                latest test reports
GET    /projects/{id}/audit-results        code-audit findings
GET    /projects/{id}/previews             preview deployments
GET    /projects/{id}/deployments
POST   /projects/{id}/actions/deploy       { version_id, environment }
POST   /projects/{id}/actions/rollback
```

### 7.3 Runs & execution

```
POST   /runs                               start (workflow_id|project_id, version, environment, input)
GET    /runs                 /runs/{id}
GET    /runs/{id}/stream                   SSE
GET    /runs/{id}/node-executions
GET    /runs/{id}/verification-results
GET    /runs/{id}/recovery-actions
GET    /runs/{id}/quality-gates
GET    /runs/{id}/outcome                  run_outcomes verdict
POST   /runs/{id}/actions/cancel
POST   /runs/{id}/actions/retry-node       { node_execution_id }
POST   /runs/{id}/clarifications/{cid}/answer
```

### 7.4 Triggers, events, conversations

```
POST   /triggers                           create (workflow, event_type|schedule, mapping)
GET    /triggers             /triggers/{id}          /triggers/{id}/versions
POST   /triggers/{id}/actions/enable  /disable  /test
GET    /events               /events/{id}            canonical event inbox (read)
GET    /conversations        /conversations/{id}
POST   /conversations/{id}/actions/close  /reopen  /handoff
```

External webhooks do **not** enter this API — they hit the Event & Trigger Gateway ingress (`API Gateway + WAF → /ingress/{provider}/{integration_id}`), which is a separate machine surface with provider signature auth, not actor tokens.

### 7.5 Approvals & escalations

```
GET    /approvals?status=pending
GET    /approvals/{id}
POST   /approvals/{id}/actions/approve     { note }
POST   /approvals/{id}/actions/reject      { note }
GET    /escalations          /escalations/{id}
POST   /escalations/{id}/actions/claim  /resolve
```

### 7.6 Environments, integrations, artifacts, deployments

```
GET/POST      /environments               (parent-scoped)
PATCH         /environments/{id}
GET/POST      /integrations               credential_ref only — secrets never in API
POST          /integrations/{id}/actions/test
GET           /artifacts/{id}             metadata + short-lived signed download URL
GET           /deployments/{id}
```

### 7.7 ADS

```
POST   /ads/ingestion/uploads              start upload (→ signed URL, ingestion job)
GET    /ads/ingestion/jobs/{id}
POST   /ads/sources                        connector-backed source
POST   /ads/sources/{id}/actions/sync
GET    /ads/documents        /ads/documents/{id}
POST   /ads/knowledge                      direct rules/corrections/labels
DELETE /ads/documents/{id}                 right-to-delete path
```

(Engine-internal retrieval goes ADS Client → ADS Queue, not through this API.)

### 7.8 Cost & usage

```
GET    /costs/summary                      tenant/workspace rollup
GET    /costs/by-run/{run_id}
GET    /costs/by-workflow/{id}             GET /costs/by-project/{id}
GET    /usage                              provider/resource usage series
GET/PATCH /budgets                         caps + alert thresholds
```

### 7.9 Evaluations (admin/internal Platform users)

```
GET    /evaluations          /evaluation-runs         /benchmarks
GET    /release-gates
```

### 7.10 Operations & system

```
GET    /system/provider-health             Alter capability status (not vendor internals)
GET    /system/service-health
GET    /system/degraded-capabilities
GET    /notifications
GET    /audit-events                       (admin scope; audit_db projection)
```

---

## 8. Internal Service APIs (gRPC + Protocol Buffers)

Service-to-service only; not exposed at the edge. Proto packages live in `packages/contracts`; breaking proto changes follow the same versioning discipline as HTTP.

| Service | Responsibility (RPC surface) |
|---|---|
| `alter.conversation.v1` | intent classification, goal state, clarification merge |
| `alter.planner.v1` | decompose, replan, strategy selection |
| `alter.capability.v1` | resolve node requirements |
| `alter.compiler.v1` | compile skeleton → typed WorkflowDAG, validate |
| `alter.deployctl.v1` | version promotion, canary, rollback |
| `alter.modelgw.v1` | invoke (alias-routed), stream, redact, fallback |
| `alter.toolgw.v1` | tool invoke, credential resolution, SSRF-guarded fetch |
| `alter.sandbox.v1` | session lifecycle, exec, file ops, verification suite |
| `alter.verify.v1` | gate scoring, hallucination check, severity assessment |
| `alter.recovery.v1` | classify failure, select strategy, record outcome |
| `alter.memory.v1` | writeback candidates, promotion, policy updates |
| `alter.adsq.v1` | retrieval (hybrid search, rerank, provenance, confidence) |
| `alter.cost.v1` | cost event ingest (also via queue), rollup queries |
| `alter.eval.v1` | eval run execution, release-gate checks |

`alter.binding.v1` is retired and retained only as a deprecated wire-compatibility
contract. Selection and persona creation are implemented by the intelligence
service's internal HTTP selection-binding path. The protobuf requests omit the
trusted binding context and the required no-match precondition, so they must not
be served or reintroduced without a versioned contract and a real orchestration
caller.

Async paths (cost telemetry, canonical events, drift schedules, PubSub node traffic) ride EventBridge/SQS with canonical Alter event envelopes — never raw provider payloads.

---

## 9. Contract Governance

- Single source: `packages/contracts` (Zod/JSON Schema → OpenAPI 3.1.1; proto files for gRPC). Type/Schema Contract Plane enforces validated typed objects on every handoff.
- CI: contract generation, schema validation, breaking-change detection, contract tests (schema-based) for every provider adapter and every service boundary. Mock providers implement the same contracts.
- Versioning: additive under v1; breaking → new major. Proto: field-number discipline, reserved fields, no type reuse across meanings.
- Canonical event schema (see Tech Spec §5.2) is part of the contract package and versioned by `schema_version`.
