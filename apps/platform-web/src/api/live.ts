import { apiDelete, apiGet, apiPatch, apiPost, mutationKey } from "./http"
import { compileDag } from "./compile-dag"
import type {
  Artifact,
  DashboardOverview,
  DashboardSummary,
  IncomingEvent,
  Member,
  NodeTypeDefinition,
  Profile,
  Project,
  ProjectFile,
  Run,
  Session,
  TestResult,
  Trigger,
  WebhookEndpoint,
  Workflow,
  Workspace,
  WorkspaceRole,
  HumanAction,
  HumanActionType,
  HumanActionStatus,
  HumanActionPriority,
  Credential,
} from "./types"

type AnyRecord = Record<string, any>

export async function getDashboardSummary(fallback: DashboardSummary): Promise<DashboardSummary> {
  const [workflows, runs] = await Promise.all([
    getWorkflows().catch(() => []),
    getRuns().catch(() => []),
  ])
  const completed = runs.filter((run) => run.status === "completed").length
  return {
    ...fallback,
    activeWorkflows: workflows.filter((workflow) => workflow.status === "active").length,
    runsToday: runs.length,
    successRate: runs.length ? Math.round((completed / runs.length) * 100) : fallback.successRate,
    recentWorkflows: workflows.slice(0, 5),
    recentRuns: runs.slice(0, 5),
  }
}

export async function getDashboardOverview(fallback: DashboardOverview): Promise<DashboardOverview> {
  const [workflows, runs] = await Promise.all([
    getWorkflows().catch(() => []),
    getRuns().catch(() => []),
  ])
  return {
    ...fallback,
    metrics: {
      activeWorkflows: workflows.filter((workflow) => workflow.status === "active").length,
      runsToday: runs.length,
      successRate: runs.length
        ? Math.round((runs.filter((run) => run.status === "completed").length / runs.length) * 100)
        : fallback.metrics.successRate,
      needsAttention: fallback.metrics.needsAttention,
    },
    liveRuns: runs.filter((run) => run.status === "running" || run.status === "waiting").slice(0, 5),
    projectBuilds: runs.filter((run) => run.mode === "project").slice(0, 5),
  }
}

export async function getWorkspaces(): Promise<Workspace[]> {
  const body = await apiGet<unknown>("/api/v1/workspaces")
  return asArray(body, "workspaces").map(mapWorkspace)
}

export async function createWorkspace(data: { name: string; slug: string }): Promise<Workspace> {
  const body = await apiPost<unknown>("/api/v1/workspaces", { name: data.name }, {
    idempotencyKey: mutationKey("workspace-create"),
  })
  return mapWorkspace(body)
}

export async function updateWorkspace(id: string, data: Partial<Workspace>): Promise<Workspace> {
  const current = await apiGet<unknown>(`/api/v1/workspaces/${encodeURIComponent(id)}`)
  const body = await apiPatch<unknown>(
    `/api/v1/workspaces/${encodeURIComponent(id)}`,
    { name: data.name },
    { ifMatch: etagFromWorkspace(current) },
  )
  return mapWorkspace(body)
}

export async function getMembers(): Promise<Member[]> {
  const body = await apiGet<unknown>("/api/v1/members")
  return asArray(body, "members").map(mapMember)
}

export async function inviteMember(email: string, role: WorkspaceRole): Promise<Member> {
  const body = await apiPost<unknown>("/api/v1/members", { email, role }, {
    idempotencyKey: mutationKey("member-invite"),
  })
  return mapMember(body)
}

export async function removeMember(memberId: string): Promise<void> {
  await apiDelete(`/api/v1/members/${encodeURIComponent(memberId)}`)
}

export async function getProfile(fallback: Profile): Promise<Profile> {
  // GET /api/v1/auth/me is the real profile read (identity.controller.ts's
  // `me` handler); it returns {userId, tenantId, email, name} -- no
  // jobTitle/avatarUrl on the backend, so those keep coming from fallback,
  // same as this function already did for fields it can't fill in.
  const body = await apiGet<{ userId?: string; email?: string; name?: string }>("/api/v1/auth/me")
  return {
    ...fallback,
    id: body.userId ?? fallback.id,
    email: body.email ?? fallback.email,
    name: body.name ?? fallback.name,
  }
}

export async function getSessions(): Promise<Session[]> {
  const body = await apiGet<unknown>("/api/v1/auth/sessions")
  return asArray(body, "sessions").map(mapSession)
}

export async function revokeSession(sessionId: string): Promise<void> {
  await apiDelete(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`)
}

// This is a personal preference (language-settings.tsx's own copy: "the
// language you prefer for the AlterX interface"), not a workspace setting,
// so this hits the per-user endpoint (i18n.controller.ts's
// updateUserLanguage), not i18n/workspaces/:id/language. The UI passes
// BCP-47-ish codes ("en-US"/"hi-IN"); the backend only accepts the bare
// subtag ("en"/"hi" -- i18n/types.ts's supportedLocales), hence the split.
export async function updateLanguage(lang: string): Promise<void> {
  const language = lang.split("-")[0]
  await apiPatch("/api/v1/i18n/users/me/language", { language })
}

export async function getWorkflows(): Promise<Workflow[]> {
  const body = await apiGet<unknown>("/api/v1/workflows")
  return asArray(body, "workflows").map(mapWorkflow)
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return mapWorkflow(await apiGet<unknown>(`/api/v1/workflows/${encodeURIComponent(id)}`))
}

export async function createWorkflow(goal: string): Promise<Workflow> {
  return mapWorkflow(await apiPost<unknown>("/api/v1/workflows", { goal }, {
    idempotencyKey: mutationKey("workflow-create"),
  }))
}

export async function saveWorkflowGraph(id: string, graph: { nodes: any[]; edges: any[] }): Promise<void> {
  await apiPatch(
    `/api/v1/workflows/${encodeURIComponent(id)}`,
    { dag: compileDag(graph.nodes, graph.edges) },
    { idempotencyKey: mutationKey("workflow-save") },
  )
}

export async function getNodeTypes(): Promise<NodeTypeDefinition[]> {
  const body = await apiGet<unknown>("/api/v1/node-types")
  return asArray(body, "node_types").map(mapNodeType)
}

export async function workflowAction(id: string, action: string, body: unknown = {}): Promise<unknown> {
  return apiPost(`/api/v1/workflows/${encodeURIComponent(id)}/actions/${action}`, body, {
    idempotencyKey: mutationKey(`workflow-${action}`),
  })
}

export async function getRuns(): Promise<Run[]> {
  const body = await apiGet<unknown>("/api/v1/runs")
  return asArray(body, "runs").map(mapRun)
}

export async function getRun(id: string): Promise<Run> {
  const body = await apiGet<unknown>(`/api/v1/runs/${encodeURIComponent(id)}`)
  return mapRun((body as AnyRecord)?.run ?? body)
}

export async function retryRun(id: string, nodeKey: string): Promise<Run> {
  await apiPost(`/api/v1/runs/${encodeURIComponent(id)}/actions/retry-node`, { node_key: nodeKey }, {
    idempotencyKey: mutationKey("run-retry"),
  })
  return getRun(id)
}

export async function stopRun(id: string): Promise<void> {
  await apiPost(`/api/v1/runs/${encodeURIComponent(id)}/actions/cancel`, {}, {
    idempotencyKey: mutationKey("run-cancel"),
  })
}

interface CredentialResponse {
  id: string
  name: string
  connector: string
  scope: string
  last4: string
  created_at: string
  version: string
}

function mapCredential(value: CredentialResponse): Credential {
  return {
    id: value.id,
    name: value.name,
    type: "secret",
    provider: value.connector,
    maskedValue: `••••${value.last4}`,
    createdAt: value.created_at,
    updatedAt: value.created_at,
    usedByConnectionIds: [],
  }
}

// Mirrors computeEtag in apps/platform-api/src/concurrency/etag.ts exactly:
// sha256("version:<version>") as base64url, quoted. PATCH /credentials/:id
// is @EtagConstrained() -- IfMatchGuard re-derives this same hash
// server-side from the current DB record's version and 412s anything else
// (apps/platform-api/src/concurrency/if-match.guard.ts). apiRequest's
// wrapper doesn't expose response headers (see api/http.ts), so this
// recomputes the value from the `version` field already in the GET body
// rather than reading a real ETag header off the wire.
async function computeCredentialEtag(version: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`version:${version}`))
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return `"${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}"`
}

export async function getCredentials(): Promise<Credential[]> {
  const body = await apiGet<CredentialResponse[]>("/api/v1/credentials")
  return body.map(mapCredential)
}

export async function getCredential(id: string): Promise<Credential> {
  const body = await apiGet<CredentialResponse>(`/api/v1/credentials/${encodeURIComponent(id)}`)
  return mapCredential(body)
}

export async function createCredential(data: {
  name: string
  connector: string
  scope: string
  value: string
}): Promise<Credential> {
  const body = await apiPost<CredentialResponse>("/api/v1/credentials", data, {
    idempotencyKey: mutationKey("credential-create"),
  })
  return mapCredential(body)
}

// updateCredential (metadata) and replaceCredentialSecret (secret rotation)
// share this: there is no separate rotate-secret backend route, both go
// through the same PATCH with different fields populated (see
// credential.controller.ts / validation.ts's updateSchema, .strict() --
// only name/connector/scope/value are ever accepted, so callers must not
// pass any other key).
async function patchCredential(
  id: string,
  data: { name?: string; connector?: string; scope?: string; value?: string },
): Promise<Credential> {
  const encodedId = encodeURIComponent(id)
  const current = await apiGet<CredentialResponse>(`/api/v1/credentials/${encodedId}`)
  const body = await apiPatch<CredentialResponse>(`/api/v1/credentials/${encodedId}`, data, {
    idempotencyKey: mutationKey("credential-update"),
    ifMatch: await computeCredentialEtag(current.version),
  })
  return mapCredential(body)
}

export async function updateCredential(
  id: string,
  data: { name?: string; connector?: string; scope?: string },
): Promise<Credential> {
  return patchCredential(id, data)
}

export async function replaceCredentialSecret(id: string, secretValue: string): Promise<Credential> {
  return patchCredential(id, { value: secretValue })
}

export async function deleteCredential(id: string): Promise<void> {
  await apiDelete(`/api/v1/credentials/${encodeURIComponent(id)}`, {
    idempotencyKey: mutationKey("credential-delete"),
  })
}

export async function getArtifact(id: string): Promise<Artifact> {
  return mapArtifact(await apiGet<unknown>(`/api/v1/artifacts/${encodeURIComponent(id)}`))
}

export async function getArtifactsByRun(runId: string): Promise<Artifact[]> {
  const run = await apiGet<AnyRecord>(`/api/v1/runs/${encodeURIComponent(runId)}`)
  return asArray(run, "artifacts").map(mapArtifact)
}

export async function getProjects(): Promise<Project[]> {
  const body = await apiGet<unknown>("/api/v1/projects")
  return asArray(body, "projects").map(mapProject)
}

export async function getProject(id: string): Promise<Project> {
  return mapProject(await apiGet<unknown>(`/api/v1/projects/${encodeURIComponent(id)}`))
}

export async function createProject(goal: string): Promise<Project> {
  return mapProject(await apiPost<unknown>("/api/v1/projects", { brief: goal }, {
    idempotencyKey: mutationKey("project-create"),
  }))
}

export async function getProjectBuild(id: string): Promise<Run> {
  const body = await apiGet<unknown>(`/api/v1/projects/${encodeURIComponent(id)}/builds`)
  return mapRun(asArray(body, "builds")[0] ?? body)
}

export async function startProjectBuild(id: string): Promise<{ runId: string }> {
  const body = await apiPost<AnyRecord>(`/api/v1/projects/${encodeURIComponent(id)}/builds`, {}, {
    idempotencyKey: mutationKey("project-build"),
  })
  return { runId: String(body.run_id ?? body.runId ?? body.build_id ?? body.id ?? "") }
}

export async function approveProjectPlan(id: string): Promise<void> {
  await apiPost(`/api/v1/projects/${encodeURIComponent(id)}/plan/actions/approve`, {}, {
    idempotencyKey: mutationKey("project-plan-approve"),
  })
}

export async function getProjectFiles(id: string): Promise<ProjectFile[]> {
  const body = await apiGet<unknown>(`/api/v1/projects/${encodeURIComponent(id)}/repository`)
  return asArray(body, "files").map(mapProjectFile)
}

export async function getProjectTests(id: string): Promise<TestResult[]> {
  const body = await apiGet<unknown>(`/api/v1/projects/${encodeURIComponent(id)}/tests`)
  return asArray(body, "tests").map(mapTest)
}

export async function getProjectAudit(id: string): Promise<{ category: string; status: string; message: string }[]> {
  const body = await apiGet<unknown>(`/api/v1/projects/${encodeURIComponent(id)}/audit-results`)
  return asArray(body, "results").map((item) => ({
    category: String(item.category ?? item.type ?? "Audit"),
    status: String(item.status ?? item.result ?? "unknown"),
    message: String(item.message ?? item.summary ?? ""),
  }))
}

export async function getProjectPreview(id: string): Promise<{ url: string; status: string }> {
  const body = await apiGet<AnyRecord>(`/api/v1/projects/${encodeURIComponent(id)}/previews`)
  const preview = asArray(body, "previews")[0] ?? body
  return { url: String(preview.url ?? preview.preview_url ?? "about:blank"), status: String(preview.status ?? "ready") }
}

export async function getTriggers(workflowId: string): Promise<Trigger[]> {
  const body = await apiGet<unknown>(`/api/v1/triggers?workflowId=${encodeURIComponent(workflowId)}`)
  return asArray(body, "triggers").map(mapTrigger)
}

export async function getTrigger(id: string): Promise<Trigger> {
  return mapTrigger(await apiGet<unknown>(`/api/v1/triggers/${encodeURIComponent(id)}`))
}

export async function createTrigger(data: Partial<Trigger>): Promise<Trigger> {
  const body = await apiPost<AnyRecord>("/api/v1/triggers", backendTrigger(data), {
    idempotencyKey: mutationKey("trigger-create"),
  })
  return mapTrigger(body.trigger ?? body)
}

export async function updateTrigger(id: string, data: Partial<Trigger>): Promise<Trigger> {
  const current = await getTrigger(id)
  return mapTrigger(await apiPatch(`/api/v1/triggers/${encodeURIComponent(id)}/status`, { status: data.enabled === false ? "disabled" : data.status }, {
    idempotencyKey: mutationKey("trigger-status"),
    ifMatch: `"${current.updatedAt}"`,
  }))
}

export async function testTrigger(id: string): Promise<{ success: boolean; message: string; eventId?: string }> {
  const body = await apiPost<AnyRecord>(`/api/v1/triggers/${encodeURIComponent(id)}/actions/test`, {}, {
    idempotencyKey: mutationKey("trigger-test"),
  })
  return { success: true, message: "Trigger test accepted.", eventId: asString(body.eventId ?? body.event_id) }
}

export async function enableTrigger(id: string): Promise<Trigger> {
  return mapTrigger(await apiPost(`/api/v1/triggers/${encodeURIComponent(id)}/actions/enable`, {}, {
    idempotencyKey: mutationKey("trigger-enable"),
  }))
}

export async function disableTrigger(id: string): Promise<Trigger> {
  return updateTrigger(id, { status: "configured", enabled: false })
}

export async function getEvents(filters?: any): Promise<IncomingEvent[]> {
  const query = new URLSearchParams(filters ?? {})
  const body = await apiGet<unknown>(`/api/v1/events${query.size ? `?${query}` : ""}`)
  return asArray(body, "events").map(mapEvent)
}

export async function getEvent(id: string): Promise<IncomingEvent> {
  return mapEvent(await apiGet<unknown>(`/api/v1/events/${encodeURIComponent(id)}`))
}

export async function getWebhooks(): Promise<WebhookEndpoint[]> {
  return []
}

function asArray(value: unknown, key: string): AnyRecord[] {
  if (Array.isArray(value)) return value as AnyRecord[]
  const record = (value ?? {}) as AnyRecord
  if (Array.isArray(record[key])) return record[key]
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.items)) return record.items
  return []
}

function mapWorkspace(value: unknown): Workspace {
  const item = value as AnyRecord
  const name = String(item.name ?? "Workspace")
  return {
    id: asString(item.id ?? item.workspace_id),
    name,
    slug: String(item.slug ?? slugify(name)),
    role: mapRole(item.role ?? item.roles?.[0]),
    memberCount: Number(item.memberCount ?? item.member_count ?? 0),
    createdAt: asDate(item.createdAt ?? item.created_at ?? item.updatedAt ?? item.updated_at),
  }
}

function mapMember(value: unknown): Member {
  const item = value as AnyRecord
  const email = String(item.email ?? item.invited_email ?? "")
  return {
    id: asString(item.id ?? item.user_id ?? item.memberId),
    name: String(item.name ?? item.displayName ?? item.display_name ?? email.split("@")[0] ?? "Member"),
    email,
    role: mapRole(item.role),
    status: String(item.status ?? "active") as Member["status"],
    joinedAt: asDate(item.joinedAt ?? item.joined_at ?? item.createdAt ?? item.created_at),
    avatarUrl: item.avatarUrl ?? item.avatar_url,
  }
}

function mapSession(value: unknown): Session {
  const item = value as AnyRecord
  return {
    id: asString(item.id ?? item.sessionId ?? item.session_id),
    device: String(item.device ?? item.deviceInfo?.device ?? "Unknown device"),
    browser: String(item.browser ?? item.deviceInfo?.browser ?? item.deviceInfo?.userAgent ?? "Unknown browser"),
    location: String(item.location ?? "Unknown"),
    ip: String(item.ip ?? ""),
    lastActive: asDate(item.lastActive ?? item.last_active_at ?? item.createdAt ?? item.created_at),
    isCurrent: Boolean(item.isCurrent ?? item.is_current ?? false),
  }
}

function mapWorkflow(value: unknown): Workflow {
  const item = value as AnyRecord
  return {
    id: asString(item.id ?? item.workflow_id),
    name: String(item.name ?? item.title ?? item.goal ?? "Untitled workflow"),
    description: item.description ?? item.summary,
    status: mapWorkflowStatus(item.status),
    runs: Number(item.runs ?? item.run_count ?? 0),
    successRate: Number(item.successRate ?? item.success_rate ?? 0),
    updatedAt: asDate(item.updatedAt ?? item.updated_at ?? item.createdAt ?? item.created_at),
    dag: item.dag ?? undefined,
  }
}

// Inspector reads config fields as node.data[key] with an optional
// { label, default } describing each -- not raw JSON Schema. Adapt the
// registry's JSON Schema config_schema_json into that flat shape.
function mapNodeType(value: unknown): NodeTypeDefinition {
  const item = value as AnyRecord
  let configSchema: Record<string, { label: string; default?: unknown }> = {}
  try {
    const parsed = JSON.parse(String(item.config_schema_json ?? "{}")) as AnyRecord
    const properties = (parsed.properties ?? {}) as AnyRecord
    configSchema = Object.fromEntries(
      Object.keys(properties).map((key) => [key, { label: key }]),
    )
  } catch {
    configSchema = {}
  }
  return {
    type: asString(item.type),
    name: String(item.display_name ?? item.type),
    description: String(item.description ?? ""),
    category: String(item.category ?? "execution"),
    inputs: [],
    outputs: [],
    configSchema,
  }
}

function mapRun(value: unknown): Run {
  const item = value as AnyRecord
  const workflowId = item.workflowId ?? item.workflow_id
  const projectId = item.projectId ?? item.project_id
  return {
    id: asString(item.id ?? item.run_id ?? item.build_id),
    workflowId,
    workflowName: item.workflowName ?? item.workflow_name,
    projectId,
    projectName: item.projectName ?? item.project_name,
    mode: projectId ? "project" : "workflow",
    status: mapRunStatus(item.status),
    startedAt: item.startedAt ?? item.started_at,
    completedAt: item.completedAt ?? item.completed_at,
    durationMs: item.durationMs ?? item.duration_ms,
    nodeCount: item.nodeCount ?? item.node_count,
    currentNodeId: item.currentNodeId ?? item.current_node_id,
    createdAt: asDate(item.createdAt ?? item.created_at ?? item.startedAt ?? item.started_at),
  }
}

function mapProject(value: unknown): Project {
  const item = value as AnyRecord
  const brief = item.brief
  return {
    id: asString(item.id ?? item.project_id),
    name: String(item.name ?? item.title ?? (typeof brief === "string" ? brief.slice(0, 60) : "Untitled project")),
    status: mapProjectStatus(item.status),
    brief: typeof brief === "object" ? brief : brief ? { goal: String(brief), primaryUsers: "", coreCapabilities: [] } : undefined,
    plan: item.plan,
    createdAt: asDate(item.createdAt ?? item.created_at),
    updatedAt: asDate(item.updatedAt ?? item.updated_at ?? item.createdAt ?? item.created_at),
  }
}

function mapArtifact(value: unknown): Artifact {
  const item = value as AnyRecord
  return {
    id: asString(item.id ?? item.artifact_id),
    runId: asString(item.runId ?? item.run_id),
    nodeId: item.nodeId ?? item.node_id,
    name: String(item.name ?? item.filename ?? "Artifact"),
    type: String(item.type ?? "file") as Artifact["type"],
    mimeType: item.mimeType ?? item.mime_type,
    sizeBytes: item.sizeBytes ?? item.size_bytes,
    createdAt: asDate(item.createdAt ?? item.created_at),
    previewUrl: item.previewUrl ?? item.preview_url,
    downloadUrl: item.downloadUrl ?? item.download_url,
    metadata: item.metadata,
  }
}

function mapProjectFile(value: unknown): ProjectFile {
  const item = value as AnyRecord
  const path = String(item.path ?? item.file_path ?? item.name ?? "")
  return {
    id: asString(item.id ?? path),
    path,
    name: String(item.name ?? path.split("/").pop() ?? path),
    type: String(item.type ?? "file") as ProjectFile["type"],
    language: item.language,
    status: item.status,
    content: item.content ?? item.diff,
  }
}

function mapTest(value: unknown): TestResult {
  const item = value as AnyRecord
  return {
    id: asString(item.id ?? item.test_id),
    name: String(item.name ?? item.title ?? "Test"),
    suite: item.suite,
    status: String(item.status ?? item.result ?? "skipped") as TestResult["status"],
    durationMs: item.durationMs ?? item.duration_ms,
    error: item.error ?? item.message,
  }
}

function mapTrigger(value: unknown): Trigger {
  const item = value as AnyRecord
  const status = String(item.status ?? "needs_configuration")
  return {
    id: asString(item.id ?? item.trigger_id),
    workflowId: asString(item.workflowId ?? item.workflow_id),
    type: String(item.type ?? "webhook") as Trigger["type"],
    name: String(item.name ?? "Trigger"),
    enabled: Boolean(item.enabled ?? status === "active"),
    status: (status === "active" ? "configured" : status) as Trigger["status"],
    config: item.config ?? {},
    lastTriggeredAt: item.lastTriggeredAt ?? item.last_triggered_at,
    lastTestedAt: item.lastTestedAt ?? item.last_tested_at,
    createdAt: asDate(item.createdAt ?? item.created_at),
    updatedAt: asDate(item.updatedAt ?? item.updated_at ?? item.createdAt ?? item.created_at),
  }
}

function backendTrigger(data: Partial<Trigger>) {
  return {
    workspaceId: (data as AnyRecord).workspaceId,
    workflowId: data.workflowId,
    name: data.name,
    type: data.type,
    config: data.config ?? {},
  }
}

function mapEvent(value: unknown): IncomingEvent {
  const item = value as AnyRecord
  return {
    id: asString(item.id ?? item.event_id),
    source: String(item.source ?? "internal") as IncomingEvent["source"],
    type: String(item.type ?? item.event_type ?? "event"),
    status: String(item.status ?? "received") as IncomingEvent["status"],
    workflowId: item.workflowId ?? item.workflow_id,
    triggerId: item.triggerId ?? item.trigger_id,
    runId: item.runId ?? item.run_id,
    receivedAt: asDate(item.receivedAt ?? item.received_at ?? item.createdAt ?? item.created_at),
  }
}

function etagFromWorkspace(value: unknown) {
  const item = value as AnyRecord
  return `"${asDate(item.updatedAt ?? item.updated_at)}"`
}

function mapRole(value: unknown): WorkspaceRole {
  return value === "owner" || value === "admin" || value === "member" || value === "viewer"
    ? value
    : "member"
}

function mapWorkflowStatus(value: unknown): Workflow["status"] {
  return value === "active" || value === "paused" || value === "archived" ? value : "draft"
}

function mapRunStatus(value: unknown): Run["status"] {
  if (value === "pending") return "queued"
  if (value === "paused") return "waiting"
  if (value === "cancelled" || value === "failed" || value === "completed" || value === "running") return value
  return "queued"
}

function mapProjectStatus(value: unknown): Project["status"] {
  if (value === "planning" || value === "building" || value === "testing" || value === "completed" || value === "archived") return value
  if (value === "ready") return "ready"
  return "draft"
}

function asString(value: unknown) {
  return String(value ?? "")
}

function asDate(value: unknown) {
  return typeof value === "string" ? value : value instanceof Date ? value.toISOString() : new Date().toISOString()
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export async function getHumanActions(filters?: any): Promise<HumanAction[]> {
  const query = new URLSearchParams()
  if (filters?.status) query.set("status", filters.status)
  // Action centre handles filtering by type implicitly via source_type, but here we just fetch everything and filter if needed, or rely on API.
  // We'll hit the main action centre endpoint.
  const body = await apiGet<unknown>(`/api/v1/action-centre?${query.toString()}`)
  const items = asArray(body, "data")
  let actions = items.map(mapHumanAction)
  if (filters?.type) {
    actions = actions.filter((a) => a.type === filters.type)
  }
  return actions
}

export async function getHumanAction(id: string): Promise<HumanAction> {
  // We don't know the exact type from just the ID to hit the specialized endpoint directly without knowing its source,
  // but usually we get it from the list. However, if we must fetch one by ID, we'd have to try each or rely on a list filter.
  // Wait, does the backend have a generic `GET /api/v1/action-centre/:id`? No.
  // So we fetch the list and find it.
  const actions = await getHumanActions()
  const action = actions.find((a) => a.id === id)
  if (!action) throw new Error("Human action not found")
  return action
}

export async function approveHumanAction(id: string, payload?: any): Promise<HumanAction> {
  const body = await apiPost<unknown>(`/api/v1/approvals/${encodeURIComponent(id)}/actions/approve`, {
    note: payload?.comment,
  })
  return mapHumanAction({ source_type: "approval", item: body })
}

export async function rejectHumanAction(id: string, payload?: any): Promise<HumanAction> {
  const body = await apiPost<unknown>(`/api/v1/approvals/${encodeURIComponent(id)}/actions/reject`, {
    note: payload?.comment,
  })
  return mapHumanAction({ source_type: "approval", item: body })
}

export async function claimHumanAction(id: string): Promise<HumanAction> {
  // Clarifications use 'assign' to claim. Escalations use 'claim'.
  // We determine type by fetching the action first if needed, but in the UI we usually know it.
  const action = await getHumanAction(id)
  if (action.type === "clarification") {
    const body = await apiPost<unknown>(`/api/v1/clarifications/${encodeURIComponent(id)}/actions/assign`)
    return mapHumanAction({ source_type: "clarification", item: body })
  } else if (action.type === "escalation") {
    const body = await apiPost<unknown>(`/api/v1/escalations/${encodeURIComponent(id)}/actions/claim`, {})
    return mapHumanAction({ source_type: "escalation", item: body })
  }
  throw new Error("Cannot claim this type of action")
}

export async function resolveHumanAction(id: string, payload?: any): Promise<HumanAction> {
  const body = await apiPost<unknown>(`/api/v1/escalations/${encodeURIComponent(id)}/actions/resolve`, {
    note: payload?.comment,
  })
  return mapHumanAction({ source_type: "escalation", item: body })
}

export async function answerHumanAction(id: string, payload?: any): Promise<HumanAction> {
  const action = await getHumanAction(id)
  const runId = action.runId
  if (!runId) throw new Error("Cannot answer clarification: missing runId")
  const body = await apiPost<unknown>(
    `/api/v1/runs/${encodeURIComponent(runId)}/clarifications/${encodeURIComponent(id)}/answer`,
    { note: payload?.comment }
  )
  return mapHumanAction({ source_type: "clarification", item: body })
}

function mapHumanAction(wrapper: unknown): HumanAction {
  const record = wrapper as AnyRecord
  const type = String(record.source_type ?? "approval") as HumanActionType
  const item = record.item as AnyRecord ?? record // Fallback if directly passing item

  const requestedAction = item.requested_action as AnyRecord | undefined
  const title = String(item.title ?? requestedAction?.title ?? (type === "approval" ? "Pending Approval" : type === "clarification" ? "Clarification Required" : "Escalation"))
  
  return {
    id: asString(item.id),
    type,
    status: mapHumanActionStatus(item.status),
    priority: String(item.priority ?? "normal") as HumanActionPriority,
    title,
    description: item.description ?? requestedAction?.description ?? item.decision_note ?? item.note,
    workspaceId: asString(item.workspace_id ?? item.tenant_id ?? ""),
    runId: asString(item.run_id ?? ""),
    workflowId: item.workflow_id,
    workflowName: item.workflow_name ?? "Unknown Workflow",
    projectId: item.project_id,
    projectName: item.project_name,
    nodeId: item.node_execution_id,
    nodeName: item.node_name ?? "Node",
    createdAt: asDate(item.requested_at ?? item.created_at ?? item.createdAt),
    dueAt: item.expiry_at ? asDate(item.expiry_at) : undefined,
    claimedBy: item.assigned_to ? { id: item.assigned_to, name: "Assigned User" } : undefined,
    claimedAt: item.assigned_at ? asDate(item.assigned_at) : undefined,
    resolvedBy: item.decided_by ? { id: item.decided_by, name: "Approver" } : undefined,
    resolvedAt: item.decided_at ? asDate(item.decided_at) : undefined,
  }
}

function mapHumanActionStatus(value: unknown): HumanActionStatus {
  if (value === "pending" || value === "open") return "open"
  if (value === "claimed" || value === "assigned") return "claimed"
  if (value === "approved" || value === "rejected" || value === "answered" || value === "resolved") return "resolved"
  if (value === "expired" || value === "cancelled") return "expired"
  return "open"
}
