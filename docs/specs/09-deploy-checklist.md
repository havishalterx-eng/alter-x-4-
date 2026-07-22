# Alter — Deployment / Launch Checklist

**Version:** 1.0
**Date:** 2026-07-22
**Status:** Approved baseline. Target: production-deployed, client-onboarding-ready by August 2, 2026. Client onboarding begins after Aug 2 unless a customer commits earlier.

---

## 1. Foundation (before any service deploys)

- [ ] AWS Organizations + Control Tower landing zone: 8 accounts (`management`, `log-archive`, `security`, `shared-services`, `dev`, `staging`, `prod`, `sandbox-exec`)
- [ ] Service Control Policies applied; IAM Identity Center for humans; cross-account CI deploy roles
- [ ] Terraform state backend (S3 + locking) in shared-services; all infra Terraform-managed from first resource
- [ ] Region `ap-south-1`, Multi-AZ; per-environment KMS keys; per-account budgets + alerts
- [ ] **Domain: CONFIRM OWNERSHIP FIRST — no invented domain.** Once confirmed: `app.` (Platform), `api.` (private API), `status.` (status page), `auth.` (branded login)
- [ ] Route 53 hosted zones; ACM certificates; WAF + CloudFront/ALB on public surfaces; low TTL during releases; DNS health checks + failover-ready records

## 2. Managed Services Provisioning

- [ ] Temporal Cloud namespaces: dev / staging / prod; API keys in Secrets Manager
- [ ] Aurora PostgreSQL Serverless v2: control-plane cluster (7 DBs, per-service credentials, RLS forced) + separate ADS cluster
- [ ] ElastiCache Redis per environment
- [ ] S3 buckets (artifacts, uploads, ADS content, audit archive) — versioning on; Object Lock on audit/critical backups; lifecycle rules; cross-account replication for critical artifacts
- [ ] EventBridge bus + SQS queues (FIFO where ordered); DLQs everywhere
- [ ] Auth0 tenant: Organizations, Universal Login on `auth.` domain, M2M applications, Identity Broker signing keys
- [ ] E2B, Browserbase, Tavily, Vercel, GitHub org (project repos), Bedrock model access (ap-south-1 or approved cross-region inference), Anthropic + OpenAI fallback keys — all credentials in Secrets Manager under naming convention
- [ ] AppConfig applications/environments/profiles; SSM parameters seeded
- [ ] Presidio deployment (Fargate) with Indian-identifier recognizers (Aadhaar, PAN, GSTIN, phone, bank)

## 3. Observability & Alerting

- [ ] Grafana Cloud: metrics, logs, traces, dashboards, alert rules (OTel pipeline; no direct vendor calls from services — `ObservabilityProvider`)
- [ ] Langfuse Cloud: LLM traces, prompt/version tracking, eval runs, cost/latency analysis (`LLMObservabilityProvider`; self-host later if residency/scale demands)
- [ ] Sentry SaaS: frontend + backend errors, release regression detection, source maps
- [ ] Dashboards live before go-live: VACR/VADR, run outcomes, event ingestion, provider health, cost burn, SLO panels
- [ ] Alert routing — Slack: operational + warning; PagerDuty: critical + escalation; phone push/call: Sev-1 only
- [ ] Severity ladder: **Sev-1** security breach / cross-tenant leak / outage / data loss / unsafe external action · **Sev-2** major degradation, provider outage without fallback, widespread failed runs · **Sev-3** isolated failures, latency, quota approach · **Sev-4** informational
- [ ] On-call: weekly rotation, 7 engineers, primary + secondary; relevant subsystem owner auto-added; all-hands only Sev-1 or incident-commander escalation

## 4. Backups & Restore

- [ ] Aurora: PITR enabled; prod retention 35 days; daily snapshots; weekly retained; monthly long-term; cross-account copy to log-archive/security account; dedicated KMS keys
- [ ] S3: versioning, lifecycle on non-current versions, retention by data classification
- [ ] Automated backup verification
- [ ] **Monthly restore drill:** restore into isolated environment → validate data integrity + application startup → measure RPO/RTO → record evidence in audit system. *A backup is not valid until restore is tested.*
- [ ] Deletion ledger replay wired into every restore path

## 5. Security Pre-Launch

- [ ] GuardDuty + Security Hub active (security account admin)
- [ ] CloudTrail org-wide → log-archive account, immutable
- [ ] Red-team suite pass (injection ≥98% block, tenant leak = 0)
- [ ] Cross-tenant isolation CI evidence archived
- [ ] Secrets rotation verified (including overlap-window signing-key rotation)
- [ ] Break-glass procedure tested + audited
- [ ] Private connectivity paths validated (outbound connector / PrivateLink test)

## 6. Go-Live Runbook (production cut)

1. Staging→prod gates all green (E2E, red-team, load/SLO, chaos, backup/restore, canary + auto-rollback verified — per Test Plan §4)
2. Subsystem-owner sign-offs + cross-system UAT complete + CEO session review + final human go/no-go
3. Deploy via canary (Deployment Controller); watch SLO panels through ramp
4. Verify: event ingestion live, run start/resume, approvals flow, SSE streams, cost events landing, audit chain advancing
5. Synthetic workflow + synthetic project build executed in prod (Alter internal tenant)
6. Status page live; on-call rotation armed; rollback command rehearsed and documented
7. **Rollback plan:** canary auto-rollback on regression; DAG/workflow version rollback via Deployment Controller; infra rollback via Terraform plan history; DB via PITR into new cluster + cutover; every rollback recorded in audit

## 7. Status Page (v1 required)

`status.<alter-domain>` — expose: Platform availability, workflow execution, project builds, authentication, integrations, deployment service, incidents, scheduled maintenance. Never expose: internal service names, provider vulnerabilities, tenant information, security-sensitive architecture. Incident updates generated from incident-management workflow, **human-approved before publication**.

## 8. Client Onboarding Runbook (post-Aug 2 unless client commits earlier)

1. Tenant creation (region/residency selection recorded)
2. Workspace setup + roles
3. Identity invitations (Auth0 Organization)
4. Integration credentials collected → Secrets Manager (`/alter/prod/tenant/...`), tested via `/integrations/{id}/actions/test`
5. Network connectivity established per preference order (outbound connector → PrivateLink → peering → VPN → controlled public endpoint); per-tenant kill switch verified
6. ADS ingestion: uploads + connector sync; ingestion jobs verified; retrieval spot-checked
7. Workflow/project configuration with client; trigger definitions bound to approved versions
8. Test-mode execution (simulate + staging-style runs on real integrations in test mode)
9. Client UAT + approval thresholds configured (approval requirements, budgets, cost limits)
10. Production activation (trigger enable) — start narrow, expand
11. Monitoring: tenant dashboard, VACR tracking eligibility marked, alert routes confirmed
12. Support + escalation contacts exchanged both directions; handoff of human-escalation queue ownership
13. Rollback/offboarding path documented: trigger disable → workflow pause → data export → right-to-delete execution with deletion certificate

## 9. Final Locked Decisions

Route 53 + ACM + WAF; Grafana Cloud + Langfuse Cloud + Sentry SaaS (all behind observability provider interfaces); Slack/PagerDuty/phone three-tier alerting; weekly primary+secondary on-call across 7 engineers; Aurora PITR 35-day + snapshot ladder + cross-account copies; S3 versioning + Object Lock; monthly restore drills with audit evidence; customer status page in v1; domain must be confirmed before DNS work; no named first client yet — product must be onboarding-ready Aug 2.
