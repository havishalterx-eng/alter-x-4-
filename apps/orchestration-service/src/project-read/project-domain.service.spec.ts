import { describe, expect, it, vi } from "vitest";

import type { ConversationHandler, PlannerHandler } from "@alterx/adapters";

import { ProjectDomainService } from "./project-domain.service";
import type {
  OrchestrationTenantStore,
  OrchestrationTransactionLike,
} from "./project-read.service";

const TENANT = "ten_018f4d6e-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const BARE_TENANT = TENANT.slice("ten_".length);
const WORKSPACE = "ws_018f4d6e-bbbb-7bbb-8bbb-bbbbbbbbbbbb";

interface Plan {
  projectId: string;
  conversationId: string;
  brief: string;
  taskSkeleton: unknown;
  status: string;
  version: number;
}

function projectSkeleton(): string {
  return JSON.stringify({
    version: "1",
    entry_point: "node_generate_code",
    nodes: [{
      key: "node_generate_code",
      type: "llm",
      config: { prompt: "Generate project files" },
      depends_on: [],
    }],
  });
}

function harness(): {
  store: OrchestrationTenantStore;
  plans: Map<string, Plan>;
} {
  const plans = new Map<string, Plan>();
  const conversations = new Set<string>();
  const tx: OrchestrationTransactionLike = {
    async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      values: readonly unknown[] = [],
    ) {
      const sql = statement.replace(/\s+/g, " ").trim();
      if (sql.startsWith("INSERT INTO projects")) return { rowCount: 1, rows: [] as readonly TRow[] };
      if (sql.startsWith("INSERT INTO conversations")) {
        conversations.add(values[0] as string);
        return { rowCount: 1, rows: [] as readonly TRow[] };
      }
      if (sql.startsWith("INSERT INTO project_plans")) {
        plans.set(values[1] as string, {
          projectId: values[1] as string,
          conversationId: values[2] as string,
          brief: values[3] as string,
          taskSkeleton: null,
          status: "planning",
          version: 1,
        });
        return { rowCount: 1, rows: [] as readonly TRow[] };
      }
      if (sql.startsWith("INSERT INTO conversation_goal_states")) {
        return { rowCount: 1, rows: [] as readonly TRow[] };
      }
      if (sql.startsWith("SELECT goal_state_json")) {
        return { rowCount: 1, rows: [{
          goal_state_json: { pendingClarifications: {} }, status: "planning", revision: 0,
        }] as unknown as readonly TRow[] };
      }
      if (sql.startsWith("UPDATE conversation_goal_states")) {
        return { rowCount: 1, rows: [] as readonly TRow[] };
      }
      if (sql.startsWith("UPDATE project_plans SET task_skeleton")) {
        const plan = plans.get(values[1] as string)!;
        plan.taskSkeleton = JSON.parse(values[2] as string);
        plan.status = "pending_review";
        return { rowCount: 1, rows: [] as readonly TRow[] };
      }
      if (sql.startsWith("SELECT project_id, conversation_id")) {
        const plan = plans.get(values[1] as string);
        return plan === undefined
          ? { rowCount: 0, rows: [] as readonly TRow[] }
          : { rowCount: 1, rows: [{
            project_id: plan.projectId,
            conversation_id: plan.conversationId,
            brief: plan.brief,
            task_skeleton: plan.taskSkeleton,
            status: plan.status,
            version: plan.version,
          }] as unknown as readonly TRow[] };
      }
      if (sql.startsWith("UPDATE project_plans SET status")) {
        const plan = plans.get(values[1] as string)!;
        plan.status = values[2] as string;
        return { rowCount: 1, rows: [] as readonly TRow[] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return {
    store: { async withTenant(tenant, operation) {
      expect(tenant).toBe(BARE_TENANT);
      return operation(tx);
    } },
    plans,
  };
}

describe("ProjectDomainService", () => {
  it("turns a brief into a real Planner plan, then launches the project Executor build", async () => {
    const { store, plans } = harness();
    const planner: PlannerHandler = {
      selectStrategy: vi.fn().mockResolvedValue({ strategy: "plan_then_execute", reason: "project" }),
      decompose: vi.fn().mockResolvedValue({
        task_skeleton_json: projectSkeleton(), ambiguity_detected: false, clarification_questions: [],
      }),
      replan: vi.fn(),
    };
    const launcher = { createProjectRun: vi.fn().mockResolvedValue({ id: "run_018f4d6e-cccc-7ccc-8ccc-cccccccccccc", status: "running" }) };
    const conversations: ConversationHandler = {
      classifyIntent: vi.fn(), getGoalState: vi.fn(), mergeClarification: vi.fn(),
    };
    const service = new ProjectDomainService(store, planner, conversations, launcher as never);

    const project = await service.create(TENANT, WORKSPACE, "Build customer portal");
    expect(project).toMatchObject({ status: "pending_review", workspace_id: WORKSPACE });
    expect(project.project_id).toMatch(/^prj_/);
    expect(planner.decompose).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: TENANT, workspace_id: WORKSPACE, objective: "Build customer portal",
    }));

    await service.reviewPlan(TENANT, project.project_id, "approve");
    const build = await service.startBuild(TENANT, project.project_id);

    expect(build).toMatchObject({ project_id: project.project_id, status: "running" });
    expect(launcher.createProjectRun).toHaveBeenCalledWith(TENANT, expect.objectContaining({
      projectId: project.project_id,
      template_id: "project-default",
      compiledDag: expect.objectContaining({ entry_node_keys: ["node_generate_code"] }),
    }));
    expect(plans.get(project.project_id)?.status).toBe("building");
  });
});
