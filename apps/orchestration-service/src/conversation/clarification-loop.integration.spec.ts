import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PlannerHandler } from "@alterx/adapters";
import { PostgresOrchestrationStoreProvider } from "@alterx/adapters";

import { ConversationManagerService } from "./conversation-manager.service";
import { ClarificationLoopService } from "./clarification-loop.service";
import { ProjectDomainService, ProjectStateConflictError } from "../project-read/project-domain.service";

const migrationsFolder = resolve(process.cwd(), "apps/orchestration-service/drizzle");
const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_TENANT_ID = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const OTHER_TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ac";
const WORKSPACE_ID = "ws_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const BARE_WORKSPACE_ID = "018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function prefixedUuidV7(prefix: string): string {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}

function problemSpec(objective: string) {
  return {
    objective,
    current_situation: null,
    actors: [],
    systems_involved: [],
    constraints: [],
    required_data: [],
    risk: "unknown",
    missing_information: [],
    success_criteria: [],
    context_references: [],
  };
}

function controlledPlanner(): PlannerHandler {
  let decomposeCalls = 0;
  return {
    understand: vi.fn(async (request) => problemSpec(request.objective)),
    selectStrategy: vi.fn(async () => ({ strategy: "plan_then_execute", reason: "project" })),
    decompose: vi.fn(async () => {
      decomposeCalls += 1;
      if (decomposeCalls === 1) {
        return {
          task_skeleton_json: "{}",
          ambiguity_detected: true,
          clarification_questions: ["Which quarter?", "Which format?"],
        };
      }
      return {
        task_skeleton_json: JSON.stringify({ version: "1", nodes: [], entry_point: "done" }),
        ambiguity_detected: false,
        clarification_questions: [],
      };
    }),
    replan: vi.fn(async () => ({ revised_skeleton_json: "{}", reason: "" })),
  };
}

function throwingModelGateway() {
  return { async invoke(): Promise<never> { throw new Error("not used by clarification merge"); } };
}

describe.sequential("Clarification Loop durable integration", () => {
  let container: StartedPostgreSqlContainer;
  let store: PostgresOrchestrationStoreProvider;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16.6-alpine")
      .withDatabase("clarification_loop")
      .withUsername("clarification_loop")
      .withPassword(randomUUID())
      .start();
    store = new PostgresOrchestrationStoreProvider({
      authentication: "static",
      connectionString: container.getConnectionUri(),
      migrationsFolder,
    });
    await store.migrate();
  }, 60_000);

  afterAll(async () => {
    await store?.close();
    await container?.stop();
  }, 30_000);

  it("pauses durably, preserves a partial answer, and reaches ready through ProjectDomain", async () => {
    const planner = controlledPlanner();
    const manager = new ConversationManagerService(store, throwingModelGateway());
    const projects = new ProjectDomainService(
      store,
      planner,
      manager,
      { createProjectRun: vi.fn() } as never,
    );

    const project = await projects.create(TENANT_ID, WORKSPACE_ID, "Build customer portal");
    expect(project.status).toBe("awaiting_clarification");

    const questions = await projects.clarifications(TENANT_ID, project.project_id);
    expect(questions.data).toHaveLength(2);
    const quarter = questions.data.find((question) => question.question === "Which quarter?");
    const format = questions.data.find((question) => question.question === "Which format?");
    expect(quarter?.clarification_id).toMatch(/^clr_/);
    expect(format?.clarification_id).toMatch(/^clr_/);

    await expect(projects.clarifications(OTHER_TENANT_ID, project.project_id)).rejects.toThrow();
    const partial = await projects.answerClarification(
      TENANT_ID,
      project.project_id,
      quarter!.clarification_id,
      "Q3 2026",
    );
    expect(partial.status).toBe("awaiting_clarification");
    expect(planner.decompose).toHaveBeenCalledTimes(1);
    expect((await projects.clarifications(TENANT_ID, project.project_id)).data).toEqual([
      expect.objectContaining({ clarification_id: format!.clarification_id, question: "Which format?" }),
    ]);

    const ready = await projects.answerClarification(
      TENANT_ID,
      project.project_id,
      format!.clarification_id,
      "PDF",
    );
    expect(ready.status).toBe("pending_review");
    expect(planner.decompose).toHaveBeenCalledTimes(2);
    await expect(
      projects.answerClarification(TENANT_ID, project.project_id, format!.clarification_id, "PDF"),
    ).rejects.toThrow(ProjectStateConflictError);

    const state = await manager.getGoalState({
      tenant_id: TENANT_ID,
      conversation_id: project.conversation_id,
    });
    expect(state.status).toBe("ready");
    expect(JSON.parse(state.goal_state_json).pendingQuestions).toEqual({});
  });

  it("allows only one concurrent resume to claim answered questions", async () => {
    const planner = controlledPlanner();
    const manager = new ConversationManagerService(store, throwingModelGateway());
    const loop = new ClarificationLoopService(store, planner);
    const conversationId = prefixedUuidV7("cnv");
    await store.withTenant(BARE_TENANT_ID, (tx) => tx.query(
      `INSERT INTO conversations (id, tenant_id, workspace_id, channel, temporal_workflow_id)
       VALUES ($1, $2, $3, 'api', $4)`,
      [conversationId, BARE_TENANT_ID, BARE_WORKSPACE_ID, prefixedUuidV7("convwf")],
    ));
    const initial = await loop.requestPlan({
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      conversationId,
      runId: prefixedUuidV7("run"),
      objective: "Build customer portal",
      mode: "project",
    });
    if (initial.status !== "awaiting_clarification") throw new Error("expected ambiguity");
    await Promise.all(initial.questions.map((question) => manager.mergeClarification({
      tenant_id: TENANT_ID,
      conversation_id: conversationId,
      clarification_id: question.clarificationId,
      answer: question.question,
    })));

    const request = {
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      conversationId,
      runId: prefixedUuidV7("run"),
      originalObjective: "Build customer portal",
      mode: "project",
    };
    const results = await Promise.allSettled([
      loop.resumeAfterClarification(request),
      loop.resumeAfterClarification(request),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(planner.decompose).toHaveBeenCalledTimes(2);
  });
});
