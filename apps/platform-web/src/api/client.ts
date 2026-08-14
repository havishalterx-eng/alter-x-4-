
import { usageService, budgetsService, costEstimatesService } from "./services/usage"
import { billingService } from "./services/billing"
import { marketplaceService } from "./services/marketplace"
import { sellerService } from "./services/seller"
import { globalSearchService } from "./services/global-search"
import { notificationsService } from "./services/notifications"
import { discoveryService } from "./services/discovery"
import { benchmarksService } from "./services/benchmarks"
import { AdminTenantsService } from "./services/admin-tenants"
import { AdminUsersService } from "./services/admin-users"
import { AuditService } from "./services/audit"
import { ProvidersService } from "./services/providers"
import { DeploymentsService } from "./services/deployments"
import { IncidentsService } from "./services/incidents"
import { PoliciesService } from "./services/policies"
import { SecurityService } from "./services/security"
import { BillingOpsService } from "./services/billing-ops"
import { MarketplaceAdminService } from "./services/marketplace-admin"
import { FeatureFlagsService } from "./services/feature-flags"
import { SupportAccessService } from "./services/support-access"
import { isLiveApi } from "./http"
import * as live from "./live"
import { 
  mockWorkflows, mockRuns, mockDashboardSummary, 
  mockWorkspaces, mockMembers, mockProfile, mockSessions, delay,
  mockNodeTypes, mockProjects, mockArtifacts,
  mockHumanActions, mockHumanAnnotations, mockRecoveryEvents, mockWorkflowHealth,
  mockConversations, mockConversationMessages, mockTriggers, mockWebhooks, mockEvents, mockDashboardOverview,
  mockKnowledgeSources, mockKnowledgeDocuments, mockKnowledgeChunks, mockIntegrationDefinitions, mockConnections,
  mockCredentials, mockWhatsAppChannels, mockVoiceChannels, mockMemoryConfig
} from "./mock/data"
import { 
  type Workflow, type Run, type DashboardSummary, 
  type Workspace, type Member, type WorkspaceRole, 
  type Profile, type Session,
  type Project, type ProjectBrief, type NodeTypeDefinition,
  type Artifact, type ProjectFile, type TestResult,
  type HumanAction, type HumanAnnotation, type RecoveryEvent, type WorkflowHealth, type NodeVerification,
  type Conversation, type ConversationMessage, type Trigger, type WebhookEndpoint, type IncomingEvent, type DashboardOverview,
  type KnowledgeSource, type KnowledgeDocument, type KnowledgeChunk, type IntegrationDefinition, type Connection,
  type Credential, type WhatsAppChannel, type VoiceChannel, type MemoryConfiguration, type RetrievalResult
} from "./types"

const MOCK_DELAY = 600

class ApiClient {
  async getDashboardSummary(): Promise<DashboardSummary> {
    if (isLiveApi) return live.getDashboardSummary(mockDashboardSummary)
    await delay(MOCK_DELAY)
    if (typeof window !== "undefined" && window.location.search.includes("mockError=dashboard")) {
      throw new Error("Failed to load dashboard summary")
    }
    return mockDashboardSummary
  }

  async getWorkflows(): Promise<Workflow[]> {
    if (isLiveApi) return live.getWorkflows()
    await delay(MOCK_DELAY)
    return mockWorkflows
  }

  async getRuns(): Promise<Run[]> {
    if (isLiveApi) return live.getRuns()
    await delay(MOCK_DELAY)
    return mockRuns
  }

  async getRun(id: string): Promise<Run> {
    if (isLiveApi) return live.getRun(id)
    await delay(MOCK_DELAY)
    const run = mockRuns.find(r => r.id === id)
    if (!run) throw new Error("Run not found")
    return run
  }

  async stopRun(_id: string): Promise<void> {
    if (isLiveApi) return live.stopRun(_id)
    await delay(MOCK_DELAY)
  }

  async retryRun(_id: string): Promise<Run> {
    if (isLiveApi) return live.retryRun(_id)
    await delay(MOCK_DELAY)
    return {
      ...mockRuns[0],
      id: `run_${Date.now()}`,
      status: "running",
      startedAt: new Date().toISOString(),
      durationMs: undefined,
      completedAt: undefined
    }
  }

  async getArtifacts(): Promise<Artifact[]> {
    await delay(MOCK_DELAY)
    return mockArtifacts
  }

  async getRunArtifacts(runId: string): Promise<Artifact[]> {
    if (isLiveApi) return live.getArtifactsByRun(runId)
    await delay(MOCK_DELAY)
    return mockArtifacts.filter(a => a.runId === runId)
  }

  async getArtifact(id: string): Promise<Artifact> {
    if (isLiveApi) return live.getArtifact(id)
    await delay(MOCK_DELAY)
    const art = mockArtifacts.find(a => a.id === id)
    if (!art) throw new Error("Artifact not found")
    return art
  }

  // Workspaces
  async getWorkspaces(): Promise<Workspace[]> {
    if (isLiveApi) return live.getWorkspaces()
    await delay(MOCK_DELAY)
    return mockWorkspaces
  }

  async createWorkspace(data: { name: string; slug: string }): Promise<Workspace> {
    if (isLiveApi) return live.createWorkspace(data)
    await delay(MOCK_DELAY)
    return {
      id: `ws_${Date.now()}`,
      name: data.name,
      slug: data.slug,
      role: "owner",
      memberCount: 1,
      createdAt: new Date().toISOString()
    }
  }

  async updateWorkspace(id: string, data: Partial<Workspace>): Promise<Workspace> {
    if (isLiveApi) return live.updateWorkspace(id, data)
    await delay(MOCK_DELAY)
    const ws = mockWorkspaces.find(w => w.id === id)
    if (!ws) throw new Error("Workspace not found")
    return { ...ws, ...data }
  }

  async deleteWorkspace(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockWorkspaces.findIndex(w => w.id === id)
    if (idx === -1) throw new Error("Workspace not found")
    // Mock: remove from array
    mockWorkspaces.splice(idx, 1)
  }

  // Members
  async getMembers(_workspaceId: string): Promise<Member[]> {
    if (isLiveApi) return live.getMembers()
    await delay(MOCK_DELAY)
    return mockMembers
  }

  async inviteMember(_workspaceId: string, email: string, role: WorkspaceRole): Promise<Member> {
    if (isLiveApi) return live.inviteMember(email, role)
    await delay(MOCK_DELAY)
    return {
      id: `usr_${Date.now()}`,
      name: email.split("@")[0],
      email,
      role,
      status: "invited",
      joinedAt: new Date().toISOString()
    }
  }

  async updateMemberRole(_workspaceId: string, _memberId: string, _role: WorkspaceRole): Promise<void> {
    await delay(MOCK_DELAY)
  }

  async removeMember(_workspaceId: string, _memberId: string): Promise<void> {
    if (isLiveApi) return live.removeMember(_memberId)
    await delay(MOCK_DELAY)
  }

  async resendInvite(_workspaceId: string, _memberId: string): Promise<void> {
    await delay(MOCK_DELAY)
  }

  // Settings: Profile
  async getProfile(): Promise<Profile> {
    if (isLiveApi) return live.getProfile(mockProfile)
    await delay(MOCK_DELAY)
    return mockProfile
  }

  async updateProfile(data: Partial<Profile>): Promise<Profile> {
    await delay(MOCK_DELAY)
    return { ...mockProfile, ...data }
  }

  // Settings: Security
  async changePassword(_data: any): Promise<void> {
    await delay(MOCK_DELAY)
  }

  // Settings: Sessions
  async getSessions(): Promise<Session[]> {
    if (isLiveApi) return live.getSessions()
    await delay(MOCK_DELAY)
    return mockSessions
  }

  async revokeSession(_sessionId: string): Promise<void> {
    if (isLiveApi) return live.revokeSession(_sessionId)
    await delay(MOCK_DELAY)
  }

  async revokeOtherSessions(): Promise<void> {
    await delay(MOCK_DELAY)
  }

  // Settings: Language
  async getLanguage(): Promise<string> {
    await delay(MOCK_DELAY)
    return localStorage.getItem("alterx_lang") || "en-US"
  }

  async updateLanguage(lang: string): Promise<void> {
    await delay(MOCK_DELAY)
    localStorage.setItem("alterx_lang", lang)
  }
  // Node Types
  async getNodeTypes(): Promise<NodeTypeDefinition[]> {
    await delay(MOCK_DELAY)
    return mockNodeTypes
  }

  // Workflows (Builder phase)
  async getWorkflow(id: string): Promise<Workflow> {
    if (isLiveApi) return live.getWorkflow(id)
    await delay(MOCK_DELAY)
    const wf = mockWorkflows.find(w => w.id === id)
    if (!wf) throw new Error("Workflow not found")
    return wf
  }

  async compileWorkflow(_data: { goal: string; answers: any }): Promise<{ workflow: Workflow, explanation: string, warnings: any[], questions: any[] }> {
    if (isLiveApi) {
      const newWorkflow = await live.createWorkflow(_data.goal);
      const planRes = await live.workflowAction(newWorkflow.id, "plan", { goal: _data.goal, answers: _data.answers }) as any;
      
      if (planRes.type === "clarification") {
        return {
          workflow: newWorkflow,
          explanation: "I need more details to compile the workflow.",
          warnings: [],
          questions: planRes.questions,
        };
      }
      
      // Successfully compiled - fetch the latest workflow object to get the DAG
      const updatedWorkflow = await live.getWorkflow(newWorkflow.id);
      return {
        workflow: updatedWorkflow,
        explanation: "Workflow compiled successfully.",
        warnings: [],
        questions: [],
      };
    }
    await delay(MOCK_DELAY * 2)
    const newWorkflow = {
      ...mockWorkflows[0],
      id: `wf_${Date.now()}`,
      name: "Generated Workflow",
      status: "draft" as any
    }
    return {
      workflow: newWorkflow,
      explanation: "Compiled based on your goal.",
      warnings: [],
      questions: []
    }
  }

  async activateWorkflow(_id: string): Promise<void> {
    if (isLiveApi) {
      await live.workflowAction(_id, "activate")
      return
    }
    await delay(MOCK_DELAY)
  }

  async pauseWorkflow(_id: string): Promise<void> {
    if (isLiveApi) {
      await live.workflowAction(_id, "pause")
      return
    }
    await delay(MOCK_DELAY)
  }

  async resumeWorkflow(_id: string): Promise<void> {
    if (isLiveApi) {
      await live.workflowAction(_id, "resume")
      return
    }
    await delay(MOCK_DELAY)
  }

  async saveWorkflowGraph(_id: string, _graph: { nodes: any[], edges: any[] }): Promise<void> {
    if (isLiveApi) return live.saveWorkflowGraph(_id, _graph)
    await delay(MOCK_DELAY)
  }

  async simulateWorkflow(_id: string, _input: any): Promise<any> {
    if (isLiveApi) return live.workflowAction(_id, "simulate", _input)
    await delay(MOCK_DELAY * 3)
    return { status: "success", steps: [] }
  }

  // Projects
  async getProjects(): Promise<Project[]> {
    if (isLiveApi) return live.getProjects()
    await delay(MOCK_DELAY)
    return mockProjects
  }

  async getProject(id: string): Promise<Project> {
    if (isLiveApi) return live.getProject(id)
    await delay(MOCK_DELAY)
    const proj = mockProjects.find(p => p.id === id)
    if (!proj) throw new Error("Project not found")
    return proj
  }

  async compileProjectBrief(data: { goal: string }): Promise<ProjectBrief> {
    if (isLiveApi) {
      const project = await live.createProject(data.goal)
      return project.brief ?? {
        goal: data.goal,
        primaryUsers: "",
        coreCapabilities: [],
      }
    }
    await delay(MOCK_DELAY * 2)
    return {
      goal: data.goal,
      primaryUsers: "Identified users",
      coreCapabilities: ["Capability 1", "Capability 2"]
    }
  }

  async approveProjectPlan(_id: string): Promise<void> {
    if (isLiveApi) {
      await live.approveProjectPlan(_id)
      return
    }
    await delay(MOCK_DELAY)
  }

  async startProjectBuild(_id: string): Promise<{ runId: string }> {
    if (isLiveApi) return live.startProjectBuild(_id)
    await delay(MOCK_DELAY)
    return { runId: "run_01JAX77P" } // Mapped to our project run scenario
  }

  async getProjectBuild(id: string): Promise<Run> {
    if (isLiveApi) return live.getProjectBuild(id)
    await delay(MOCK_DELAY)
    // Find the run associated with this project (mocking)
    const run = mockRuns.find(r => r.projectId === id)
    if (!run) throw new Error("Build run not found")
    return run
  }

  async getProjectFiles(_id: string): Promise<ProjectFile[]> {
    if (isLiveApi) return live.getProjectFiles(_id)
    await delay(MOCK_DELAY)
    return [
      { id: "f_1", path: "src", name: "src", type: "directory" },
      { id: "f_2", path: "src/app", name: "app", type: "directory" },
      { id: "f_3", path: "src/app/App.tsx", name: "App.tsx", type: "file", language: "typescript", status: "unchanged" },
      { id: "f_4", path: "src/components", name: "components", type: "directory" },
      { id: "f_5", path: "src/components/Button.tsx", name: "Button.tsx", type: "file", language: "typescript", status: "unchanged" },
      { id: "f_6", path: "src/main.tsx", name: "main.tsx", type: "file", language: "typescript", status: "modified" },
    ]
  }

  async getProjectChanges(_id: string): Promise<ProjectFile[]> {
    if (isLiveApi) return live.getProjectFiles(_id)
    await delay(MOCK_DELAY)
    return [
      { id: "f_6", path: "src/main.tsx", name: "main.tsx", type: "file", language: "typescript", status: "modified", content: "- import { App } from './App'\n+ import { App } from './app/App'" },
    ]
  }

  async getProjectTests(_id: string): Promise<TestResult[]> {
    if (isLiveApi) return live.getProjectTests(_id)
    await delay(MOCK_DELAY)
    return [
      { id: "t_1", name: "Authentication renders", status: "passed", durationMs: 145 },
      { id: "t_2", name: "Sidebar navigation works", status: "passed", durationMs: 234 },
      { id: "t_3", name: "Dashboard loads workflows", status: "failed", error: "Expected 'Customer Support' to be visible, but element was not found.", durationMs: 405 },
      { id: "t_4", name: "Mobile navigation", status: "skipped" }
    ]
  }

  async getProjectAudit(_id: string): Promise<{ category: string, status: string, message: string }[]> {
    if (isLiveApi) return live.getProjectAudit(_id)
    await delay(MOCK_DELAY)
    return [
      { category: "TypeScript", status: "pass", message: "No TypeScript errors detected." },
      { category: "Accessibility", status: "warning", message: "2 icon-only buttons require labels." },
      { category: "Security", status: "pass", message: "No insecure dependencies found." }
    ]
  }

  async getProjectPreview(_id: string): Promise<{ url: string, status: string }> {
    if (isLiveApi) return live.getProjectPreview(_id)
    await delay(MOCK_DELAY)
    return { url: "about:blank", status: "ready" }
  }

  // Human Actions
  async getHumanActions(filters?: any): Promise<HumanAction[]> {
    if (isLiveApi) return live.getHumanActions(filters)
    await delay(MOCK_DELAY)
    let actions = [...mockHumanActions]
    if (filters?.status) actions = actions.filter(a => a.status === filters.status)
    if (filters?.type) actions = actions.filter(a => a.type === filters.type)
    return actions
  }

  async getHumanAction(id: string): Promise<HumanAction> {
    if (isLiveApi) return live.getHumanAction(id)
    await delay(MOCK_DELAY)
    const action = mockHumanActions.find(a => a.id === id)
    if (!action) throw new Error("Human action not found")
    return action
  }

  async claimHumanAction(id: string): Promise<HumanAction> {
    if (isLiveApi) return live.claimHumanAction(id)
    await delay(MOCK_DELAY)
    const action = mockHumanActions.find(a => a.id === id)
    if (!action) throw new Error("Human action not found")
    if (action.status !== "open") throw new Error("Action is not open")
    action.status = "claimed"
    action.claimedBy = { id: "usr_1", name: "Ameen" }
    action.claimedAt = new Date().toISOString()
    return action
  }

  async approveHumanAction(id: string, payload?: any): Promise<HumanAction> {
    if (isLiveApi) return live.approveHumanAction(id, payload)
    await delay(MOCK_DELAY)
    const action = mockHumanActions.find(a => a.id === id)
    if (!action) throw new Error("Human action not found")
    action.status = "resolved"
    action.resolution = "approved"
    action.resolvedBy = { id: "usr_1", name: "Ameen" }
    action.resolvedAt = new Date().toISOString()
    return action
  }

  async rejectHumanAction(id: string, payload?: any): Promise<HumanAction> {
    if (isLiveApi) return live.rejectHumanAction(id, payload)
    await delay(MOCK_DELAY)
    const action = mockHumanActions.find(a => a.id === id)
    if (!action) throw new Error("Human action not found")
    action.status = "resolved"
    action.resolution = "rejected"
    action.resolvedBy = { id: "usr_1", name: "Ameen" }
    action.resolvedAt = new Date().toISOString()
    return action
  }

  async answerHumanAction(id: string, payload: any): Promise<HumanAction> {
    if (isLiveApi) return live.answerHumanAction(id, payload)
    await delay(MOCK_DELAY)
    const action = mockHumanActions.find(a => a.id === id)
    if (!action) throw new Error("Human action not found")
    action.status = "resolved"
    action.resolution = "answered"
    action.resolvedBy = { id: "usr_1", name: "Ameen" }
    action.resolvedAt = new Date().toISOString()
    return action
  }

  async resolveHumanAction(id: string, payload?: any): Promise<HumanAction> {
    if (isLiveApi) return live.resolveHumanAction(id, payload)
    await delay(MOCK_DELAY)
    const action = mockHumanActions.find(a => a.id === id)
    if (!action) throw new Error("Human action not found")
    action.status = "resolved"
    action.resolution = "resolved"
    action.resolvedBy = { id: "usr_1", name: "Ameen" }
    action.resolvedAt = new Date().toISOString()
    return action
  }

  async getHumanActionHistory(id: string): Promise<HumanAnnotation[]> {
    await delay(MOCK_DELAY)
    return mockHumanAnnotations.filter(a => a.actionId === id)
  }

  async addHumanAnnotation(id: string, text: string): Promise<HumanAnnotation> {
    await delay(MOCK_DELAY)
    const annotation: HumanAnnotation = {
      id: `ann_${Date.now()}`,
      actionId: id,
      author: { id: "usr_1", name: "Ameen" },
      text,
      createdAt: new Date().toISOString()
    }
    mockHumanAnnotations.push(annotation)
    return annotation
  }

  // Recovery
  async getRecoveryHistory(runId: string): Promise<RecoveryEvent[]> {
    await delay(MOCK_DELAY)
    return mockRecoveryEvents.filter(e => e.runId === runId)
  }

  async retryNode(_runId: string, _nodeId: string): Promise<void> {
    await delay(MOCK_DELAY)
  }

  async skipNode(_runId: string, _nodeId: string): Promise<void> {
    await delay(MOCK_DELAY)
  }

  async resumeRun(_runId: string): Promise<void> {
    await delay(MOCK_DELAY)
  }

  async abortRun(_runId: string): Promise<void> {
    await delay(MOCK_DELAY)
  }

  // Workflow Health
  async getWorkflowHealths(): Promise<WorkflowHealth[]> {
    await delay(MOCK_DELAY)
    return mockWorkflowHealth
  }

  async getWorkflowHealth(workflowId: string): Promise<WorkflowHealth> {
    await delay(MOCK_DELAY)
    const health = mockWorkflowHealth.find(h => h.workflowId === workflowId)
    if (!health) throw new Error("Workflow health not found")
    return health
  }

  // Node Verification
  async getNodeVerification(_runId: string, nodeId: string): Promise<NodeVerification> {
    await delay(MOCK_DELAY)
    if (nodeId === "node_refund") {
      return {
        status: "passed",
        summary: "Refund transaction simulated successfully",
        checks: [
          { id: "c1", name: "Amount check", status: "passed", message: "Amount is within limits" }
        ]
      }
    }
    return {
      status: "warning",
      summary: "Node execution returned partial results",
      checks: [
        { id: "c1", name: "Schema check", status: "passed" },
        { id: "c2", name: "Confidence threshold", status: "warning", message: "0.71 < 0.80" }
      ]
    }
  }

  // Phase 6: Conversations
  async getConversations(filters?: any): Promise<Conversation[]> {
    await delay(MOCK_DELAY)
    let convs = [...mockConversations]
    if (filters?.type) convs = convs.filter(c => c.type === filters.type)
    return convs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  async getConversation(id: string): Promise<Conversation> {
    await delay(MOCK_DELAY)
    const conv = mockConversations.find(c => c.id === id)
    if (!conv) throw new Error("Conversation not found")
    return conv
  }

  async createConversation(data: { type: string; title: string; linkedWorkflowId?: string; linkedProjectId?: string; linkedRunId?: string }): Promise<Conversation> {
    await delay(MOCK_DELAY)
    const conv: Conversation = {
      id: `conv_${Date.now()}`,
      title: data.title,
      type: data.type as any,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: { id: "usr_1", name: "Ameen" },
      linkedWorkflowId: data.linkedWorkflowId,
      linkedProjectId: data.linkedProjectId,
      linkedRunId: data.linkedRunId,
      preview: "New conversation started."
    }
    mockConversations.push(conv)
    mockConversationMessages[conv.id] = []
    return conv
  }

  async getConversationMessages(id: string): Promise<ConversationMessage[]> {
    await delay(MOCK_DELAY)
    return mockConversationMessages[id] || []
  }

  async sendMessage(id: string, payload: { content: any; kind?: string }): Promise<{ userMessage: ConversationMessage; assistantMessage?: ConversationMessage }> {
    await delay(MOCK_DELAY)
    if (!mockConversationMessages[id]) {
      mockConversationMessages[id] = []
    }
    
    const userMessage: ConversationMessage = {
      id: `msg_${Date.now()}`,
      conversationId: id,
      role: "user",
      kind: (payload.kind as any) || "text",
      createdAt: new Date().toISOString(),
      content: payload.content
    }
    mockConversationMessages[id].push(userMessage)

    const conv = mockConversations.find(c => c.id === id)
    if (conv) {
      conv.updatedAt = new Date().toISOString()
      conv.preview = typeof payload.content === 'string' ? payload.content : "Sent a message"
    }

    // Deterministic mock assistant response
    let assistantMessage: ConversationMessage | undefined
    
    await delay(MOCK_DELAY * 2) // Simulate thinking
    
    if (typeof payload.content === 'string') {
      const text = payload.content.toLowerCase()
      
      if (text.includes("build") || text.includes("create")) {
        assistantMessage = {
          id: `msg_${Date.now() + 1}`,
          conversationId: id,
          role: "assistant",
          kind: "action",
          createdAt: new Date().toISOString(),
          content: {
            text: "I can help with that. Should we create a new Workflow or a new Project?",
            actions: [
              { label: "Create Workflow", href: "/app/workflows/new" },
              { label: "Create Project", href: "/app/projects/new" }
            ]
          }
        }
      } else if (text.includes("fail") || text.includes("error")) {
        assistantMessage = {
          id: `msg_${Date.now() + 1}`,
          conversationId: id,
          role: "assistant",
          kind: "run",
          createdAt: new Date().toISOString(),
          content: {
            summary: "I found a recent run that failed.",
            runId: "run_01JAX48P",
            error: "Failed at node validation."
          }
        }
      } else {
        assistantMessage = {
          id: `msg_${Date.now() + 1}`,
          conversationId: id,
          role: "assistant",
          kind: "text",
          createdAt: new Date().toISOString(),
          content: "I am AlterX. I can help you build workflows, investigate runs, or manage your projects. What would you like to do?"
        }
      }
      
      if (assistantMessage) {
        mockConversationMessages[id].push(assistantMessage)
      }
    }

    return { userMessage, assistantMessage }
  }

  async archiveConversation(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const conv = mockConversations.find(c => c.id === id)
    if (conv) conv.status = "archived"
  }

  // Phase 6: Triggers
  async getTriggers(workflowId: string): Promise<Trigger[]> {
    if (isLiveApi) return live.getTriggers(workflowId)
    await delay(MOCK_DELAY)
    return mockTriggers.filter(t => t.workflowId === workflowId)
  }

  async getTrigger(id: string): Promise<Trigger> {
    if (isLiveApi) return live.getTrigger(id)
    await delay(MOCK_DELAY)
    const t = mockTriggers.find(t => t.id === id)
    if (!t) throw new Error("Trigger not found")
    return t
  }

  async createTrigger(data: Partial<Trigger>): Promise<Trigger> {
    if (isLiveApi) return live.createTrigger(data)
    await delay(MOCK_DELAY)
    const t: Trigger = {
      id: `trg_${Date.now()}`,
      workflowId: data.workflowId!,
      type: data.type!,
      name: data.name || "New Trigger",
      enabled: false,
      status: "needs_configuration",
      config: data.config || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockTriggers.push(t)
    return t
  }

  async updateTrigger(id: string, data: Partial<Trigger>): Promise<Trigger> {
    if (isLiveApi) return live.updateTrigger(id, data)
    await delay(MOCK_DELAY)
    const t = mockTriggers.find(t => t.id === id)
    if (!t) throw new Error("Trigger not found")
    Object.assign(t, data, { updatedAt: new Date().toISOString() })
    return t
  }

  async testTrigger(id: string): Promise<{ success: boolean; message: string; eventId?: string }> {
    if (isLiveApi) return live.testTrigger(id)
    await delay(MOCK_DELAY * 2)
    const t = mockTriggers.find(t => t.id === id)
    if (!t) throw new Error("Trigger not found")
    t.lastTestedAt = new Date().toISOString()
    
    if (t.type === "webhook") {
      return { success: true, message: "Webhook payload accepted.", eventId: "evt_01" }
    } else {
      return { success: false, message: "Required field missing in mock payload." }
    }
  }

  async enableTrigger(id: string): Promise<Trigger> {
    if (isLiveApi) return live.enableTrigger(id)
    await delay(MOCK_DELAY)
    const t = mockTriggers.find(t => t.id === id)
    if (!t) throw new Error("Trigger not found")
    if (t.status === "error" || t.status === "needs_configuration") {
      throw new Error("Cannot enable a trigger that needs configuration.")
    }
    t.enabled = true
    t.updatedAt = new Date().toISOString()
    return t
  }

  async disableTrigger(id: string): Promise<Trigger> {
    if (isLiveApi) return live.disableTrigger(id)
    await delay(MOCK_DELAY)
    const t = mockTriggers.find(t => t.id === id)
    if (!t) throw new Error("Trigger not found")
    t.enabled = false
    t.updatedAt = new Date().toISOString()
    return t
  }

  async removeTrigger(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const index = mockTriggers.findIndex(t => t.id === id)
    if (index > -1) mockTriggers.splice(index, 1)
  }

  // Phase 6: Webhooks
  async getWebhooks(): Promise<WebhookEndpoint[]> {
    if (isLiveApi) return live.getWebhooks()
    await delay(MOCK_DELAY)
    return mockWebhooks
  }

  // Phase 6: Events
  async getEvents(filters?: any): Promise<IncomingEvent[]> {
    if (isLiveApi) return live.getEvents(filters)
    await delay(MOCK_DELAY)
    let events = [...mockEvents]
    if (filters?.source) events = events.filter(e => e.source === filters.source)
    if (filters?.status) events = events.filter(e => e.status === filters.status)
    return events.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
  }

  async getEvent(id: string): Promise<IncomingEvent> {
    if (isLiveApi) return live.getEvent(id)
    await delay(MOCK_DELAY)
    const e = mockEvents.find(e => e.id === id)
    if (!e) throw new Error("Event not found")
    return e
  }

  async replayEvent(_id: string): Promise<{ runId: string }> {
    await delay(MOCK_DELAY * 2)
    return { runId: `run_${Date.now()}` }
  }

  // Phase 6: Dashboard Aggregates
  async getDashboardOverview(): Promise<DashboardOverview> {
    if (isLiveApi) return live.getDashboardOverview(mockDashboardOverview)
    await delay(MOCK_DELAY)
    return mockDashboardOverview
  }

  // Phase 7: Knowledge API
  async getKnowledgeSources(): Promise<KnowledgeSource[]> {
    await delay(MOCK_DELAY)
    return mockKnowledgeSources.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  async getKnowledgeSource(id: string): Promise<KnowledgeSource> {
    await delay(MOCK_DELAY)
    const s = mockKnowledgeSources.find(s => s.id === id)
    if (!s) throw new Error("Knowledge source not found")
    return s
  }

  async createKnowledgeSource(data: Partial<KnowledgeSource>): Promise<KnowledgeSource> {
    await delay(MOCK_DELAY * 2)
    const s: KnowledgeSource = {
      id: `ks_${Date.now()}`,
      name: data.name || "New Source",
      type: data.type || "file_upload",
      status: "processing",
      documentCount: data.documentCount || 0,
      chunkCount: data.chunkCount || 0,
      connectionId: data.connectionId,
      config: data.config,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    mockKnowledgeSources.push(s)
    return s
  }

  async syncKnowledgeSource(id: string): Promise<KnowledgeSource> {
    await delay(MOCK_DELAY * 2)
    const s = mockKnowledgeSources.find(s => s.id === id)
    if (!s) throw new Error("Source not found")
    s.status = "syncing"
    s.updatedAt = new Date().toISOString()
    return s
  }

  async reindexKnowledgeSource(id: string): Promise<KnowledgeSource> {
    await delay(MOCK_DELAY * 2)
    const s = mockKnowledgeSources.find(s => s.id === id)
    if (!s) throw new Error("Source not found")
    s.status = "processing"
    s.updatedAt = new Date().toISOString()
    return s
  }

  async deleteKnowledgeSource(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockKnowledgeSources.findIndex(s => s.id === id)
    if (idx > -1) mockKnowledgeSources.splice(idx, 1)
  }

  async getKnowledgeDocuments(sourceId: string): Promise<KnowledgeDocument[]> {
    await delay(MOCK_DELAY)
    return mockKnowledgeDocuments.filter(d => d.sourceId === sourceId)
  }

  async retryKnowledgeDocument(id: string): Promise<KnowledgeDocument> {
    await delay(MOCK_DELAY)
    const d = mockKnowledgeDocuments.find(d => d.id === id)
    if (!d) throw new Error("Document not found")
    d.status = "processing"
    d.error = undefined
    return d
  }

  async getKnowledgeChunks(sourceId: string, documentId: string): Promise<KnowledgeChunk[]> {
    await delay(MOCK_DELAY)
    return mockKnowledgeChunks.filter(c => c.sourceId === sourceId && c.documentId === documentId)
  }

  async testRetrieval(query: string, filters?: any): Promise<RetrievalResult[]> {
    await delay(MOCK_DELAY * 2)
    
    if (filters?.sources?.includes("ks_03")) { // Mock syncing source
       throw new Error("One selected source is still indexing.")
    }
    
    if (query.toLowerCase().includes("empty") || query.toLowerCase().includes("none")) {
       return []
    }
    
    // Return mock results
    return [
      {
        id: `res_${Date.now()}_1`,
        chunkId: "chunk_018",
        sourceId: "ks_02",
        documentId: "doc_01",
        content: "Annual subscriptions may receive a prorated refund if cancelled within the first 30 days of the billing cycle. After 30 days, no refunds will be issued for annual plans.",
        score: 0.92,
        confidence: "high",
        provenance: [
          {
            id: "prov_1",
            sourceId: "ks_02",
            sourceName: "Support Policies",
            documentId: "doc_01",
            documentName: "refund-policy.pdf",
            chunkId: "chunk_018",
          }
        ]
      },
      {
        id: `res_${Date.now()}_2`,
        chunkId: "chunk_019",
        sourceId: "ks_02",
        documentId: "doc_01",
        content: "Monthly subscriptions are non-refundable. If you cancel a monthly subscription, you will retain access to the platform until the end of your current billing period.",
        score: 0.78,
        confidence: "medium",
        provenance: [
          {
            id: "prov_2",
            sourceId: "ks_02",
            sourceName: "Support Policies",
            documentId: "doc_01",
            documentName: "refund-policy.pdf",
            chunkId: "chunk_019",
          }
        ]
      }
    ]
  }

  async getMemoryConfiguration(): Promise<MemoryConfiguration> {
    await delay(MOCK_DELAY)
    return mockMemoryConfig
  }

  async updateMemoryConfiguration(data: Partial<MemoryConfiguration>): Promise<MemoryConfiguration> {
    await delay(MOCK_DELAY)
    Object.assign(mockMemoryConfig, data)
    return mockMemoryConfig
  }

  async requestDataExport(): Promise<{ status: string }> {
    await delay(MOCK_DELAY * 2)
    return { status: "ready" } // Mock direct readiness
  }
  
  async deleteWorkspaceData(_scope: string): Promise<void> {
    await delay(MOCK_DELAY * 3)
  }

  // Phase 7: Connections API
  async getIntegrationCatalog(): Promise<IntegrationDefinition[]> {
    await delay(MOCK_DELAY)
    return mockIntegrationDefinitions
  }

  async getIntegration(id: string): Promise<IntegrationDefinition> {
    await delay(MOCK_DELAY)
    const i = mockIntegrationDefinitions.find(i => i.id === id)
    if (!i) throw new Error("Integration not found")
    return i
  }

  async getConnections(): Promise<Connection[]> {
    await delay(MOCK_DELAY)
    return mockConnections.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  async getConnection(id: string): Promise<Connection> {
    await delay(MOCK_DELAY)
    const c = mockConnections.find(c => c.id === id)
    if (!c) throw new Error("Connection not found")
    return c
  }

  async createConnection(data: Partial<Connection>): Promise<Connection> {
    await delay(MOCK_DELAY * 2)
    const c: Connection = {
      id: `conn_${Date.now()}`,
      integrationId: data.integrationId!,
      name: data.name || "New Connection",
      status: "connected",
      credentialId: data.credentialId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString()
    }
    mockConnections.push(c)
    return c
  }

  async testConnection(id: string): Promise<{ success: boolean; message: string }> {
    await delay(MOCK_DELAY * 2)
    const c = mockConnections.find(c => c.id === id)
    if (!c) throw new Error("Connection not found")
    c.lastCheckedAt = new Date().toISOString()
    
    if (c.status === "expired" || c.status === "error") {
      return { success: false, message: "Connection test failed. Invalid credentials or expired token." }
    }
    return { success: true, message: "Connection test successful." }
  }

  async reconnectConnection(id: string): Promise<Connection> {
    await delay(MOCK_DELAY * 2)
    const c = mockConnections.find(c => c.id === id)
    if (!c) throw new Error("Connection not found")
    c.status = "connected"
    c.lastCheckedAt = new Date().toISOString()
    return c
  }
  
  async deleteConnection(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockConnections.findIndex(c => c.id === id)
    if (idx > -1) mockConnections.splice(idx, 1)
  }

  // Phase 7: Credentials API
  async getCredentials(): Promise<Credential[]> {
    await delay(MOCK_DELAY)
    return mockCredentials.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }
  
  async getCredential(id: string): Promise<Credential> {
    await delay(MOCK_DELAY)
    const c = mockCredentials.find(c => c.id === id)
    if (!c) throw new Error("Credential not found")
    return c
  }

  async createCredential(data: Partial<Credential>): Promise<Credential> {
    await delay(MOCK_DELAY * 2)
    const c: Credential = {
      id: `cred_${Date.now()}`,
      name: data.name || "New Credential",
      type: data.type || "secret",
      provider: data.provider,
      maskedValue: data.type !== "oauth" ? "sk_••••••••" : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usedByConnectionIds: []
    }
    mockCredentials.push(c)
    return c
  }

  async updateCredential(id: string, data: Partial<Credential>): Promise<Credential> {
    await delay(MOCK_DELAY)
    const c = mockCredentials.find(c => c.id === id)
    if (!c) throw new Error("Credential not found")
    Object.assign(c, data, { updatedAt: new Date().toISOString() })
    return c
  }

  async replaceCredentialSecret(id: string, _secretValue: string): Promise<Credential> {
    await delay(MOCK_DELAY)
    const c = mockCredentials.find(c => c.id === id)
    if (!c) throw new Error("Credential not found")
    c.updatedAt = new Date().toISOString()
    return c
  }

  async deleteCredential(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const c = mockCredentials.find(c => c.id === id)
    if (!c) throw new Error("Credential not found")
    if (c.usedByConnectionIds.length > 0) {
      throw new Error("Credential is in use by one or more connections.")
    }
    const idx = mockCredentials.findIndex(c => c.id === id)
    if (idx > -1) mockCredentials.splice(idx, 1)
  }

  // Phase 7: Channels API
  async getWhatsAppChannels(): Promise<WhatsAppChannel[]> {
    await delay(MOCK_DELAY)
    return mockWhatsAppChannels
  }

  async createWhatsAppChannel(data: Partial<WhatsAppChannel>): Promise<WhatsAppChannel> {
    await delay(MOCK_DELAY * 2)
    const ch: WhatsAppChannel = {
      id: `wa_${Date.now()}`,
      name: data.name || "New Channel",
      phoneNumber: data.phoneNumber!,
      provider: data.provider || "mock",
      status: "connected",
      connectionId: data.connectionId,
      createdAt: new Date().toISOString(),
    }
    mockWhatsAppChannels.push(ch)
    return ch
  }

  async testWhatsAppChannel(_id: string): Promise<{ success: boolean; message: string }> {
    await delay(MOCK_DELAY)
    return { success: true, message: "Test message sent successfully." }
  }

  async deleteWhatsAppChannel(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockWhatsAppChannels.findIndex(c => c.id === id)
    if (idx > -1) mockWhatsAppChannels.splice(idx, 1)
  }

  async getVoiceChannels(): Promise<VoiceChannel[]> {
    await delay(MOCK_DELAY)
    return mockVoiceChannels
  }

  async createVoiceChannel(data: Partial<VoiceChannel>): Promise<VoiceChannel> {
    await delay(MOCK_DELAY * 2)
    const ch: VoiceChannel = {
      id: `vc_${Date.now()}`,
      name: data.name || "New Channel",
      phoneNumber: data.phoneNumber,
      provider: data.provider || "mock",
      status: "connected",
      connectionId: data.connectionId,
      voice: data.voice,
      language: data.language,
      createdAt: new Date().toISOString(),
    }
    mockVoiceChannels.push(ch)
    return ch
  }

  async testVoiceChannel(_id: string): Promise<{ success: boolean; message: string }> {
    await delay(MOCK_DELAY)
    return { success: true, message: "Test call initiated successfully." }
  }

  async deleteVoiceChannel(id: string): Promise<void> {
    await delay(MOCK_DELAY)
    const idx = mockVoiceChannels.findIndex(c => c.id === id)
    if (idx > -1) mockVoiceChannels.splice(idx, 1)
  }
}


const apiClient = new ApiClient();

export const api = Object.assign(apiClient, {
  usage: usageService,
  budgets: budgetsService,
  costEstimates: costEstimatesService,
  billing: billingService,
  marketplace: marketplaceService,
  seller: sellerService,
  globalSearch: globalSearchService,
  notifications: notificationsService,
  discovery: discoveryService,
  benchmarks: benchmarksService,
  admin: {
    tenants: new AdminTenantsService(),
    users: new AdminUsersService(),
    audit: new AuditService(),
    providers: new ProvidersService(),
    deployments: new DeploymentsService(),
    incidents: new IncidentsService(),
    policies: new PoliciesService(),
    security: new SecurityService(),
    billing: new BillingOpsService(),
    marketplace: new MarketplaceAdminService(),
    featureFlags: new FeatureFlagsService(),
    support: new SupportAccessService()
  }
});
