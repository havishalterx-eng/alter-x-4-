# Alter — Data Model / Schema Specification

**Version:** 1.0
**Date:** 2026-07-21
**Status:** Approved baseline. Column-level detail is the build contract; Code Writer sessions implement migrations from this document. Additive changes allowed during build with CEO approval; breaking changes require doc revision.

---

## 1. Global Conventions

- **IDs:** prefixed UUIDv7. Native `uuid` column internally; prefixed string (`ten_`, `ws_`, `usr_`, `wf_`, `prj_`, `run_`, `node_`, `evt_`, `trg_`, `agt_`, `pol_`, `cst_`, `aud_`, `doc_`, `art_`, `dep_`, `env_`, `apr_`, `cnv_`, `mem_`) at API/log boundaries. No tenant info encoded in IDs. Vendor IDs stored only as external references, never as primary keys.
- **Tenancy:** `tenant_id uuid NOT NULL` on every tenant-owned row, immutable after creation. App-level scoping in every repository method **plus** PostgreSQL RLS (`ENABLE` + `FORCE`), default-deny without tenant context. RLS exempt only for genuinely global catalogues (model catalogue, provider capability catalogue, benchmark templates, infra health). Cross-tenant access tests run in CI.
- **Timestamps:** `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz` (trigger-maintained) on mutable tables. Immutable tables (events, cost, audit) have no `updated_at`.
- **Deletion:** hard delete per right-to-delete flow (deletion manifest → tombstone → provider purge → verification → deletion certificate). No soft-delete columns except where a lifecycle status is a domain state (`status` fields). Pseudonymized survivors only in `cost_db` and `audit_db`.
- **JSON:** `jsonb` for typed-contract payloads; every jsonb column has a named schema in `packages/contracts` and a `schema_version` column alongside where the payload evolves.
- **Ownership:** one service per database; separate credentials; no cross-database joins; communication via API/events. Cluster: one Aurora Serverless v2 control-plane cluster hosting `platform_db`…`audit_db` as separate databases; ADS on its own cluster.
- **Provider portability:** all access through `RelationalDatabaseProvider` / `VectorStoreProvider` / `ObjectStorageProvider` / `CacheProvider` / `AuditStoreProvider` adapters. Standard PostgreSQL features only in business logic; no Aurora-specific behavior outside adapters. Artifact records store Alter artifact IDs, never raw S3 paths.
- **Vectors:** pgvector v1. Separate index per (provider, model, version, dimension). Mandatory metadata on every embedding row: `embedding_provider, embedding_model, embedding_version, dimension, distance_metric, created_at, source_version`. Never compare across embedding spaces. ADS retrieval = 1024-dim; semantic cache = 512-dim; capability matching = 512-dim. Titan Text Embeddings V2 default.

---

## 2. platform_db (owner: platform-api)

```sql
tenants
  id uuid PK                      -- ten_
  name text NOT NULL
  status text NOT NULL            -- active | suspended | closing | deleted
  region text NOT NULL DEFAULT 'ap-south-1'
  identity_org_ref text           -- Auth0 Organization ID (external ref)
  data_residency jsonb            -- pinning + legal basis
  retention_overrides jsonb
  security_policy jsonb
  billing_profile_id uuid
  created_at / updated_at

workspaces
  id uuid PK                      -- ws_
  tenant_id uuid NOT NULL FK→tenants
  name text NOT NULL
  status text NOT NULL
  default_model_policy jsonb      -- alias overrides within tenant policy
  default_tool_policy jsonb
  budget jsonb                    -- monthly caps, alert thresholds
  ads_scope_id uuid               -- ADS knowledge scope binding
  created_at / updated_at
  UNIQUE (tenant_id, name)

users
  id uuid PK                      -- usr_
  identity_ref text NOT NULL      -- Auth0 user ID (external ref)
  email text NOT NULL
  display_name text
  status text NOT NULL
  created_at / updated_at
  -- users are global; tenant access only via memberships

tenant_members
  id uuid PK
  tenant_id uuid NOT NULL
  user_id uuid NOT NULL FK→users
  role text NOT NULL              -- owner | admin | member | billing
  created_at
  UNIQUE (tenant_id, user_id)

workspace_members
  id uuid PK
  tenant_id uuid NOT NULL
  workspace_id uuid NOT NULL FK→workspaces
  user_id uuid NOT NULL
  role text NOT NULL              -- admin | editor | operator | approver | viewer
  created_at
  UNIQUE (workspace_id, user_id)

integrations
  id uuid PK                      -- itg_
  tenant_id uuid NOT NULL
  workspace_id uuid               -- NULL = tenant-wide
  provider text NOT NULL          -- whatsapp | shopify | crm_x | github | ...
  name text NOT NULL
  status text NOT NULL            -- connected | error | disabled
  config jsonb                    -- non-secret config
  credential_ref text NOT NULL    -- Secrets Manager reference ID, never the secret
  scopes jsonb
  last_health_check_at timestamptz
  created_at / updated_at

entitlements
  id uuid PK
  tenant_id uuid NOT NULL
  plan text NOT NULL              -- managed_v1 | ...
  limits jsonb                    -- run caps, seat caps, feature flags
  effective_from / effective_to timestamptz
  created_at
```

---

## 3. orchestration_db (owner: orchestration-service)

The largest domain: definitions, versions, triggers, runs, and the outcome ledger.

```sql
workflows
  id uuid PK                      -- wf_
  tenant_id / workspace_id uuid NOT NULL
  name text NOT NULL
  description text
  status text NOT NULL            -- draft | testing | approved | live | paused | archived
  current_version_id uuid
  origin text NOT NULL            -- generated | user_defined | hybrid
  created_by uuid
  created_at / updated_at

workflow_versions                  -- immutable
  id uuid PK                      -- wfv_
  tenant_id uuid NOT NULL
  workflow_id uuid NOT NULL FK→workflows
  version int NOT NULL
  compiled_dag jsonb NOT NULL     -- typed WorkflowDAG (waves, nodes, edges, loops, merges)
  dag_schema_version text NOT NULL
  node_requirements jsonb         -- per-node capability/model-alias/tool specs
  policy_bindings jsonb           -- policy versions in force at compile time
  compile_metadata jsonb          -- compiler version, source skeleton hash
  status text NOT NULL            -- compiled | canary | promoted | rolled_back | retired
  created_at
  UNIQUE (workflow_id, version)

projects
  id uuid PK                      -- prj_
  tenant_id / workspace_id uuid NOT NULL
  name text NOT NULL
  status text NOT NULL            -- active | maintenance | archived | deleted
  current_version_id uuid
  created_at / updated_at

project_versions                   -- immutable
  id uuid PK                      -- prv_
  tenant_id uuid NOT NULL
  project_id uuid NOT NULL
  version int NOT NULL
  commit_sha text NOT NULL
  architecture_version text
  lockfiles_hash text
  build_config jsonb
  deployment_manifest jsonb
  created_at
  UNIQUE (project_id, version)

repository_bindings
  id uuid PK
  tenant_id uuid NOT NULL
  project_id uuid NOT NULL
  provider text NOT NULL DEFAULT 'github'
  ownership text NOT NULL         -- alter_org | customer_org
  repo_external_ref text NOT NULL -- org/repo (external ref)
  default_branch text NOT NULL DEFAULT 'main'
  app_installation_ref text
  created_at / updated_at

environments                       -- per workflow OR project
  id uuid PK                      -- env_
  tenant_id uuid NOT NULL
  parent_type text NOT NULL       -- workflow | project
  parent_id uuid NOT NULL
  name text NOT NULL              -- development | preview | staging | production
  credential_refs jsonb           -- secret reference IDs only
  variables jsonb                 -- non-secret vars
  approval_requirements jsonb
  cost_limits jsonb
  created_at / updated_at
  UNIQUE (parent_type, parent_id, name)

triggers
  id uuid PK                      -- trg_
  tenant_id / workspace_id uuid NOT NULL
  workflow_id uuid NOT NULL
  environment_id uuid NOT NULL
  status text NOT NULL            -- enabled | disabled | testing
  current_version_id uuid
  created_at / updated_at

trigger_versions                   -- immutable
  id uuid PK
  tenant_id uuid NOT NULL
  trigger_id uuid NOT NULL
  version int NOT NULL
  event_type text NOT NULL        -- canonical event type, or 'schedule'
  workflow_version_id uuid NOT NULL  -- exact DAG version binding
  input_mapping jsonb             -- canonical event → workflow input transform
  schedule jsonb                  -- cron spec when event_type='schedule'
  concurrency_policy jsonb
  replay_policy jsonb
  dead_letter_config jsonb
  created_at
  UNIQUE (trigger_id, version)

events                             -- canonical event inbox (immutable)
  id uuid PK                      -- evt_
  tenant_id / workspace_id uuid NOT NULL
  event_type / schema_version text NOT NULL
  source text NOT NULL
  source_account_id / subject_id / conversation_id text
  correlation_id / causation_id uuid
  idempotency_key text NOT NULL
  occurred_at / received_at timestamptz NOT NULL
  trigger_id uuid  / trigger_version int
  payload jsonb                   -- small payloads inline
  payload_reference text          -- artifact ID for large payloads
  signature_status text NOT NULL  -- verified | unverified | failed
  dispatch_status text NOT NULL   -- received | dispatched | dead_letter | duplicate
  UNIQUE (tenant_id, source, idempotency_key)

conversations                      -- lifecycle metadata (state lives in Temporal)
  id uuid PK                      -- cnv_
  tenant_id / workspace_id uuid NOT NULL
  channel text NOT NULL           -- whatsapp | ...
  external_conversation_ref text NOT NULL
  temporal_workflow_ref text      -- external ref
  status text NOT NULL            -- active | waiting_human | closed | reopened
  active_objective text
  opened_at / closed_at timestamptz
  UNIQUE (tenant_id, channel, external_conversation_ref)

runs
  id uuid PK                      -- run_
  tenant_id / workspace_id uuid NOT NULL
  mode text NOT NULL              -- workflow | project
  parent_type text NOT NULL       -- workflow | project
  parent_id uuid NOT NULL
  version_id uuid NOT NULL        -- exact workflow_version / project_version
  environment_id uuid NOT NULL
  conversation_id uuid            -- when spawned by a conversation
  triggered_by text NOT NULL      -- event | schedule | user | recovery | ci_feedback
  trigger_event_id uuid
  temporal_run_ref text
  status text NOT NULL            -- running | paused | waiting_approval | completed
                                  -- | failed | escalated | abandoned | degraded
  started_at / ended_at timestamptz
  created_at

node_executions
  id uuid PK                      -- node_
  tenant_id uuid NOT NULL
  run_id uuid NOT NULL FK→runs
  dag_node_id text NOT NULL       -- node ID within compiled DAG
  node_type text NOT NULL         -- LLMTask | ToolCall | SandboxExec | Gate | HumanApproval
                                  -- | Merge | Synthesis | MemoryWrite | PubSub | GroupChat | YAMLImport
  attempt int NOT NULL DEFAULT 1
  agent_id uuid / agent_version int
  model_alias text                -- FAST | STANDARD | ADVANCED | CEILING
  model_resolved text             -- provider/model actually used
  status text NOT NULL            -- running | succeeded | failed | skipped | recovered
  input_ref / output_ref text     -- artifact IDs (raw I/O: 90-day retention class)
  error jsonb
  started_at / ended_at timestamptz

verification_results
  id uuid PK
  tenant_id uuid NOT NULL
  run_id uuid NOT NULL / node_execution_id uuid
  gate_type text NOT NULL         -- quality | hallucination | safety | build | render
                                  -- | placeholder | security | acceptance
  verdict text NOT NULL           -- pass | fail | warn
  score numeric
  threshold numeric
  reviewer_model text
  details jsonb
  created_at

recovery_actions
  id uuid PK
  tenant_id uuid NOT NULL
  run_id uuid NOT NULL / node_execution_id uuid
  failure_class text NOT NULL
  root_cause_estimate jsonb
  strategy text NOT NULL          -- repair | retry | backoff | swap_agent | escalate_model
                                  -- | recompile | replan | degrade | ask_user | terminate
  policy_version text NOT NULL
  outcome text                    -- resolved | failed | escalated
  created_at / resolved_at

approvals
  id uuid PK                      -- apr_
  tenant_id / workspace_id uuid NOT NULL
  run_id uuid NOT NULL / node_execution_id uuid
  requested_action jsonb NOT NULL -- what the engine wants to do
  status text NOT NULL            -- pending | approved | rejected | expired
  requested_at / decided_at timestamptz
  decided_by uuid
  decision_note text
  expiry_at timestamptz

deployments
  id uuid PK                      -- dep_
  tenant_id uuid NOT NULL
  project_id uuid NOT NULL / project_version_id uuid NOT NULL
  environment_id uuid NOT NULL
  provider text NOT NULL          -- vercel | ecs | lambda | ...
  provider_ref text               -- external deployment ID / URL
  kind text NOT NULL              -- preview | production
  status text NOT NULL            -- deploying | live | failed | rolled_back
  created_at / completed_at

artifacts                          -- metadata only; bytes in object storage
  id uuid PK                      -- art_
  tenant_id uuid NOT NULL
  run_id uuid / node_execution_id uuid
  kind text NOT NULL              -- build_log | screenshot | test_report | bundle
                                  -- | payload | diagnostic_package | release_snapshot
  storage_key_ref text NOT NULL   -- adapter-resolved, not raw bucket path
  content_type text / size_bytes bigint
  retention_class text NOT NULL   -- maps to Governance retention policy
  created_at

run_outcomes                       -- THE metric ledger (VACR / VADR source of truth)
  id uuid PK
  tenant_id / workspace_id uuid NOT NULL
  run_id uuid NOT NULL UNIQUE
  mode text NOT NULL
  eligible boolean NOT NULL       -- past onboarding/testing/production approval
  verdict text NOT NULL           -- completed_verified | rescued | escalated | failed
                                  -- | abandoned | degraded
  human_rescue boolean NOT NULL
  critical_external_error boolean NOT NULL
  gates_passed / gates_failed int
  recovery_count int
  human_repair_after_complete boolean   -- Project Mode guardrail
  decided_at timestamptz NOT NULL
```

Key indexes: `runs (tenant_id, status, started_at)`, `node_executions (run_id, dag_node_id, attempt)`, `events (tenant_id, event_type, received_at)`, `run_outcomes (tenant_id, mode, eligible, decided_at)` — the VACR query is a rolling-30-day aggregate over `run_outcomes`.

---

## 4. intelligence_db (owner: intelligence-service, SQLAlchemy/Alembic)

```sql
agents
  id uuid PK                      -- agt_
  tenant_id uuid                  -- NULL = global agent
  name text NOT NULL
  origin text NOT NULL            -- built_in | auto_created
  status text NOT NULL            -- active | deprecated | quarantined
  current_version int NOT NULL
  created_at / updated_at

agent_versions                     -- immutable
  agent_id uuid / version int PK
  persona jsonb NOT NULL          -- system prompt, style, constraints
  capability_profile jsonb NOT NULL
  allowed_tools jsonb
  default_model_alias text
  created_by text                 -- human | auto_creation
  created_at

capability_embeddings              -- 512-dim
  id uuid PK
  agent_id uuid / agent_version int
  embedding vector(512) NOT NULL
  embedding_provider / embedding_model / embedding_version text NOT NULL
  distance_metric text NOT NULL DEFAULT 'cosine'
  source_version text
  created_at
  -- HNSW index per embedding-space

performance_records
  id uuid PK
  agent_id uuid / agent_version int
  task_class text NOT NULL
  window_start / window_end timestamptz
  success_rate numeric / sample_count int
  avg_quality_score numeric
  created_at

routing_observations               -- pre-promotion evidence
  id uuid PK
  tenant_id uuid
  agent_id uuid / model_resolved text / task_class text
  observation jsonb
  promoted boolean DEFAULT false
  created_at
```

---

## 5. policy_db (owner: memory-policy-service)

Everything versioned; learning updates data, never code.

```sql
policies
  id uuid PK                      -- pol_
  scope text NOT NULL             -- global | tenant | workspace | workflow | project
  scope_id uuid
  kind text NOT NULL              -- routing_weights | quality_thresholds
                                  -- | recovery_preferences | provider_policy
                                  -- | model_alias_map | trigger_limits
  version int NOT NULL
  body jsonb NOT NULL
  status text NOT NULL            -- draft | canary | active | rolled_back | retired
  source text NOT NULL            -- human | memory_learning | drift_detector
  eval_gate_run_id uuid           -- eval run that cleared promotion
  created_at
  UNIQUE (scope, scope_id, kind, version)

policy_promotions
  id uuid PK
  policy_id uuid NOT NULL
  from_version int / to_version int
  action text NOT NULL            -- promote | rollback
  reason text
  actor text NOT NULL             -- human ID or system component
  created_at

drift_scores
  id uuid PK
  subject_type text NOT NULL      -- agent | model | provider
  subject_ref text NOT NULL
  task_class text
  score numeric NOT NULL
  baseline numeric
  window jsonb
  action_taken text               -- none | weight_decay | flagged
  created_at

memory_records                     -- engine-operational learnings staging
  id uuid PK                      -- mem_
  tenant_id uuid                  -- NULL only for anonymized global learnings
  scope text NOT NULL             -- failure | global | project | safety_pattern
  content jsonb NOT NULL
  provenance jsonb NOT NULL       -- source run, verification refs
  status text NOT NULL            -- candidate | verified | promoted | reverted
  destination text                -- policy_store | ads_memory_namespace
  created_at / promoted_at
```

---

## 6. cost_db (owner: cost-ledger-service)

Append-only events; rollups derived.

```sql
cost_events                        -- immutable
  id uuid PK                      -- cst_
  tenant_id / workspace_id uuid NOT NULL
  mode text                       -- workflow | project
  parent_id uuid / run_id uuid / node_execution_id uuid
  source text NOT NULL            -- model_gateway | tool_gateway | sandbox | storage | browser
  provider text / resource text   -- e.g. bedrock/claude-sonnet-5, e2b/vm-hours
  quantity numeric / unit text    -- tokens_in, tokens_out, seconds, requests, bytes
  internal_cost_minor bigint NOT NULL   -- minor currency units
  currency text NOT NULL DEFAULT 'INR'
  is_retry boolean DEFAULT false
  is_recovery boolean DEFAULT false
  occurred_at timestamptz NOT NULL
  -- retention: raw 24 months

billing_rollups                    -- retention: 7 years, pseudonymized after deletion
  id uuid PK
  tenant_pseudonym text NOT NULL  -- irreversible after right-to-delete
  tenant_id uuid                  -- nulled on deletion
  period_start / period_end date
  mode text
  internal_cost_minor / billable_minor / margin_minor bigint
  detail jsonb                    -- per-source breakdown
  finalized boolean
  created_at
```

---

## 7. eval_db (owner: eval-service)

```sql
golden_sets
  id uuid PK
  name text / domain text         -- planner | verification | retrieval | e2e | mode-specific
  version int NOT NULL
  status text                     -- active | retired
  created_at

eval_cases
  id uuid PK
  golden_set_id uuid NOT NULL
  input jsonb / expected jsonb
  scoring jsonb                   -- rubric / matcher config
  tags jsonb
  created_at

eval_runs
  id uuid PK
  golden_set_id uuid / golden_set_version int
  subject text NOT NULL           -- component/policy/model under test + version
  trigger text NOT NULL           -- pre_merge | promotion_gate | scheduled | manual
  status text / pass_rate numeric
  started_at / completed_at

eval_results
  id uuid PK
  eval_run_id uuid / eval_case_id uuid
  verdict text                    -- pass | fail
  score numeric / output_ref text / details jsonb

redteam_results
  id uuid PK
  suite text NOT NULL             -- injection | jailbreak | ssrf | upload | tenant_leak
  target text NOT NULL
  attack_ref text
  outcome text NOT NULL           -- blocked | detected | bypassed
  severity text
  details jsonb
  created_at

release_gates
  id uuid PK
  subject text NOT NULL           -- what wants to ship
  eval_run_id uuid
  decision text NOT NULL          -- approved | blocked
  decided_by text                 -- ceo_session | human
  created_at
```

---

## 8. audit_db (owner: audit-service)

Append-only, tamper-evident hash chain. No prompts, files, or conversation bodies — actor, action, target, result, time, integrity hash only. Retention 7 years; pseudonymized after right-to-delete.

```sql
audit_events                       -- immutable
  id uuid PK                      -- aud_
  tenant_id uuid                  -- nulled + pseudonymized on deletion
  tenant_pseudonym text
  actor_type text NOT NULL        -- user | service | admin | support | system
  actor_ref text NOT NULL
  action text NOT NULL            -- e.g. trigger.enable, policy.promote, support.access.grant
  target_type / target_ref text
  result text NOT NULL            -- success | denied | error
  reason_code text                -- required for support/break-glass access
  context jsonb                   -- request ID, IP class, scope — no content
  occurred_at timestamptz NOT NULL
  prev_hash bytea NOT NULL
  entry_hash bytea NOT NULL       -- H(prev_hash || canonical(row))

support_access_grants
  id uuid PK
  tenant_id uuid NOT NULL
  grantee_ref text NOT NULL       -- Alter staff identity
  scope jsonb NOT NULL            -- exact tenant/workspace scope
  reason_code text NOT NULL
  approved_by text
  granted_at / expires_at timestamptz NOT NULL
  revoked_at timestamptz

deletion_certificates
  id uuid PK
  tenant_pseudonym text NOT NULL
  manifest jsonb NOT NULL         -- providers purged, verification results
  requested_at / completed_at timestamptz
  verified_by text

deletion_ledger                    -- replayed after any backup restore
  id uuid PK
  subject_pseudonym text NOT NULL
  subject_selectors jsonb NOT NULL
  deleted_at timestamptz NOT NULL
```

---

## 9. ADS Cluster (owner: ADS Core — separate Aurora cluster)

```sql
scopes                             -- knowledge scope bound to workspace
  id uuid PK
  tenant_id / workspace_id uuid NOT NULL

sources
  id uuid PK
  tenant_id / scope_id uuid NOT NULL
  kind text NOT NULL              -- upload | connector | engine_writeback | platform_input
  provider text                   -- shopify | crm | drive | ...
  integration_ref uuid            -- platform_db integration ID (external ref)
  sync_config jsonb               -- schedule | webhook | cdc
  status text
  last_sync_at timestamptz
  created_at / updated_at

documents
  id uuid PK                      -- doc_
  tenant_id / scope_id uuid NOT NULL
  source_id uuid NOT NULL
  kind text NOT NULL              -- file | record | rule | summary | verified_output | project_context
  title text
  current_version int NOT NULL
  permissions jsonb
  status text                     -- active | superseded | deleted
  created_at / updated_at

document_versions                  -- immutable
  document_id uuid / version int PK
  content_ref text                -- object-storage artifact ID (originals in S3)
  content_hash text
  normalized_ref text
  freshness_at timestamptz        -- when this info was true
  provenance jsonb NOT NULL       -- origin, chain, verification refs
  ingestion_job_id uuid
  created_at

chunks                             -- retrieval units, 1024-dim
  id uuid PK
  tenant_id / scope_id uuid NOT NULL
  document_id uuid / document_version int NOT NULL
  seq int NOT NULL
  text_content text NOT NULL
  metadata jsonb                  -- section, record keys, language
  embedding vector(1024) NOT NULL
  embedding_provider / embedding_model / embedding_version text NOT NULL
  distance_metric text DEFAULT 'cosine'
  created_at
  -- HNSW index per embedding-space; tsvector GIN index for keyword leg of hybrid search

records                            -- structured business records
  id uuid PK
  tenant_id / scope_id uuid NOT NULL
  source_id uuid NOT NULL
  entity_type text NOT NULL       -- product | customer | order | inventory | invoice | ...
  external_key text NOT NULL      -- key in source system
  body jsonb NOT NULL
  version int NOT NULL
  freshness_at timestamptz
  UNIQUE (source_id, entity_type, external_key, version)

memory_namespace                   -- tenant knowledge written by Memory & Learning
  id uuid PK
  tenant_id / scope_id uuid NOT NULL
  project_ref uuid                -- orchestration project/workflow (external ref)
  kind text NOT NULL              -- business_rule | preference | project_fact | constraint
  statement text NOT NULL         -- "manager approval required above ₹50,000"
  confidence numeric
  provenance jsonb NOT NULL       -- source run + verification
  status text                     -- active | superseded | revoked
  created_at / superseded_at

ingestion_jobs
  id uuid PK
  tenant_id / source_id uuid NOT NULL
  stage text NOT NULL             -- received | validated | scanned | normalized
                                  -- | deduplicated | chunked | indexed | failed
  stats jsonb / error jsonb
  created_at / completed_at

retrieval_audit
  id uuid PK
  tenant_id / scope_id uuid NOT NULL
  requester text NOT NULL         -- ads_client run/node ref
  query_hash text
  result_doc_ids jsonb
  confidence numeric
  created_at
```

---

## 10. Redis Keyspace (disposable — never truth)

```
bb:{run_id}:{key}                  Blackboard hot context      TTL: run lifetime
rl:{tenant}:{bucket}               rate-limit counters          TTL: window
sc:{space}:{hash}                  semantic-cache hot entries   TTL: policy-driven
lock:{resource}                    distributed locks            TTL: short
idem:{source}:{key}                idempotency short-window     TTL: dedup window
live:{run_id}                      streaming/presence state     TTL: run lifetime
corr:{correlation_id}              temporary event correlation  TTL: short
```

Rule: Redis loss degrades performance, never correctness. Blackboard durable checkpoints live in Temporal + orchestration storage; all state reconstructable after cache loss.

---

## 11. Retention Matrix (Governance-owned; adapters execute)

| Data class | Retention |
|---|---|
| Run summaries, node execution metadata | 13 months |
| Raw node inputs/outputs | 90 days |
| Verbose traces | 30 days |
| Failed-run diagnostic packages | 90 days |
| Conversation raw messages (post-close) | 90 days |
| Build logs | 90 days |
| Preview artifacts | 30 days |
| Release artifacts | project lifetime |
| Security/audit findings (Project Mode) | 13 months |
| Cost raw usage events | 24 months |
| Billing rollups | 7 years (pseudonymized post-deletion) |
| Audit records | 7 years (pseudonymized post-deletion) |
| ADS content | while active tenant purpose holds; tenant overrides allowed |
| Source code (Git) | until project deletion or repo transfer |

Every storage adapter must implement: `locateSubjectData()`, `deleteSubjectData()`, `verifyDeletion()`, `applyRetentionPolicy()`, `replayDeletionLedger()`. Providers that cannot support verifiable deletion cannot store regulated customer data. Backups expire on fixed lifecycle; restores immediately replay the deletion ledger.

---

## 12. Cross-Domain Reference Rules

- Cross-database references are **by ID only** (`external ref` columns); no FK constraints across databases; consistency via events and reconciliation jobs.
- `run_outcomes` is the single source for VACR/VADR dashboards; Cost Ledger joins by `run_id` at query time inside its own service via API-fed projections, not SQL joins.
- ADS never references orchestration rows directly — provenance stores opaque run/node refs.
- Vendor references (`identity_org_ref`, `temporal_run_ref`, `repo_external_ref`, `provider_ref`) are external strings; deleting/re-creating a vendor resource never breaks Alter IDs.
