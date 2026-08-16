import { describe, expect, it, vi } from "vitest";

import type { PlannerHandler } from "@alterx/adapters";

import {
  ClarificationLoopService,
  ClarificationLoopValidationError,
  type OrchestrationTenantStore,
} from "./clarification-loop.service";
import { emptyGoalState, type GoalState } from "./intent-taxonomy";

interface Row {
  tenant_id: string;
  conversation_id: string;
  goal_state_json: GoalState;
  status: string;
  revision: number;
}

function createFakeStore(seed: readonly Row[] = []): {
  readonly store: OrchestrationTenantStore;
  readonly rows: Row[];
} {
  const rows: Row[] = seed.map((r) => ({ ...r }));

  const store: OrchestrationTenantStore = {
    async withTenant(_tenantId, operation) {
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
          values: readonly unknown[] = [],
        ) {
          if (statement.startsWith("INSERT INTO conversation_goal_states")) {
            const [tenantId, conversationId] = values as [string, string];
            if (!rows.some((r) => r.tenant_id === tenantId && r.conversation_id === conversationId)) {
              rows.push({
                tenant_id: tenantId,
                conversation_id: conversationId,
                goal_state_json: emptyGoalState(),
                status: "planning",
                revision: 0,
              });
            }
            return { rowCount: 1, rows: [] as unknown as readonly TRow[] };
          }

          if (statement.startsWith("SELECT goal_state_json, status, revision")) {
            const [tenantId, conversationId] = values as [string, string];
            const row = rows.find(
              (r) => r.tenant_id === tenantId && r.conversation_id === conversationId,
            );
            return {
              rowCount: row === undefined ? 0 : 1,
              rows: (row === undefined
                ? []
                : [
                    {
                      goal_state_json: row.goal_state_json,
                      status: row.status,
                      revision: row.revision,
                    },
                  ]) as unknown as readonly TRow[],
            };
          }

          if (statement.startsWith("UPDATE conversation_goal_states")) {
            const [goalStateJson, status, tenantId, conversationId, expectedRevision] =
              values as [string, string, string, string, number];
            const row = rows.find(
              (r) => r.tenant_id === tenantId && r.conversation_id === conversationId,
            );
            if (row === undefined || row.revision !== expectedRevision) {
              return { rowCount: 0, rows: [] as unknown as readonly TRow[] };
            }
            row.goal_state_json = JSON.parse(goalStateJson) as GoalState;
            row.status = status;
            row.revision += 1;
            return { rowCount: 1, rows: [] as unknown as readonly TRow[] };
          }

          if (statement.startsWith("INSERT INTO clarifications")) {
            return { rowCount: 1, rows: [] as unknown as readonly TRow[] };
          }

          throw new Error(`Unhandled query in fake store: ${statement}`);
        },
      });
    },
  };

  return { store, rows };
}

function fakePlanner(overrides: Partial<PlannerHandler> = {}): PlannerHandler {
  return {
    understand:
      overrides.understand ??
      vi.fn(async (request) => ({
        objective: request.objective,
        current_situation: null,
        actors: [],
        systems_involved: [],
        constraints: [],
        required_data: [],
        risk: "unknown",
        missing_information: [],
        success_criteria: [],
        context_references: [],
      })),
    selectStrategy:
      overrides.selectStrategy ??
      vi.fn(async () => ({ strategy: "direct", reason: "concise" })),
    decompose:
      overrides.decompose ??
      vi.fn(async () => ({
        task_skeleton_json: "{}",
        ambiguity_detected: false,
        clarification_questions: [],
      })),
    replan: overrides.replan ?? vi.fn(async () => ({ revised_skeleton_json: "{}", reason: "" })),
  };
}

const BASE_REQUEST = {
  tenantId: "ten_00000000-0000-7000-8000-00000000000a",
  workspaceId: "ws_a",
  conversationId: "cnv_a",
  runId: "run_a",
  objective: "summarize the quarterly report",
  mode: "workflow",
};

describe("ClarificationLoopService.requestPlan", () => {
  it("marks the goal ready and stores the task skeleton when there's no ambiguity", async () => {
    const { store, rows } = createFakeStore();
    const planner = fakePlanner();
    const service = new ClarificationLoopService(store, planner);

    const result = await service.requestPlan(BASE_REQUEST);

    expect(result).toEqual({ status: "ready", taskSkeletonJson: "{}" });
    expect(rows[0]!.status).toBe("ready");
    expect(rows[0]!.goal_state_json.taskSkeletonJson).toBe("{}");
  });

  it("marks the goal awaiting_clarification and stores pending questions", async () => {
    const { store, rows } = createFakeStore();
    const planner = fakePlanner({
      decompose: vi.fn(async () => ({
        task_skeleton_json: "{}",
        ambiguity_detected: true,
        clarification_questions: ["Which quarter?", "Which format?"],
      })),
    });
    const service = new ClarificationLoopService(store, planner);

    const result = await service.requestPlan(BASE_REQUEST);

    expect(result.status).toBe("awaiting_clarification");
    if (result.status !== "awaiting_clarification") throw new Error("unreachable");
    expect(result.questions).toHaveLength(2);
    expect(result.questions.map((q) => q.question)).toEqual([
      "Which quarter?",
      "Which format?",
    ]);
    expect(result.questions.every((q) => q.clarificationId.startsWith("clr_"))).toBe(true);

    expect(rows[0]!.status).toBe("awaiting_clarification");
    expect(Object.values(rows[0]!.goal_state_json.pendingQuestions ?? {})).toEqual([
      "Which quarter?",
      "Which format?",
    ]);
  });

  it("passes the strategy resolved by selectStrategy into decompose", async () => {
    const { store } = createFakeStore();
    const decompose = vi.fn(async () => ({
      task_skeleton_json: "{}",
      ambiguity_detected: false,
      clarification_questions: [],
    }));
    const planner = fakePlanner({
      selectStrategy: vi.fn(async () => ({ strategy: "iterative", reason: "complex" })),
      decompose,
    });
    const service = new ClarificationLoopService(store, planner);

    await service.requestPlan(BASE_REQUEST);

    expect(decompose).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: "iterative" }),
    );
  });

  it("uses the same tenant, workspace, and run IDs for understanding and decompose", async () => {
    const { store } = createFakeStore();
    const understand = vi.fn(async (request) => ({
      objective: request.objective,
      current_situation: null,
      actors: [],
      systems_involved: [],
      constraints: [],
      required_data: [],
      risk: "unknown",
      missing_information: [],
      success_criteria: [],
      context_references: [],
    }));
    const decompose = vi.fn(async (request: unknown) => {
      void request;
      return {
      task_skeleton_json: "{}",
      ambiguity_detected: false,
      clarification_questions: [],
      };
    });
    const service = new ClarificationLoopService(
      store,
      fakePlanner({ understand, decompose }),
    );

    await service.requestPlan(BASE_REQUEST);

    const understood = understand.mock.calls[0]![0];
    const decomposed = decompose.mock.calls[0]![0];
    expect(decomposed).toMatchObject({
      tenant_id: understood.tenant_id,
      workspace_id: understood.workspace_id,
      run_id: understood.run_id,
    });
  });
});

describe("ClarificationLoopService.resumeAfterClarification", () => {
  it("folds the answered question into the objective and re-invokes the planner", async () => {
    const clarificationId = "clr_test";
    const { store, rows } = createFakeStore([
      {
        tenant_id: "00000000-0000-7000-8000-00000000000a",
        conversation_id: "cnv_a",
        goal_state_json: {
          pendingClarifications: { [clarificationId]: "Q3 2026" },
          pendingQuestions: { [clarificationId]: "Which quarter?" },
          taskSkeletonJson: null,
        },
        status: "awaiting_clarification",
        revision: 1,
      },
    ]);
    const decompose = vi.fn(async () => ({
      task_skeleton_json: "{}",
      ambiguity_detected: false,
      clarification_questions: [],
    }));
    const planner = fakePlanner({ decompose });
    const service = new ClarificationLoopService(store, planner);

    const result = await service.resumeAfterClarification({
      tenantId: "ten_00000000-0000-7000-8000-00000000000a",
      workspaceId: "ws_a",
      conversationId: "cnv_a",
      runId: "run_a",
      originalObjective: "summarize the quarterly report",
      mode: "workflow",
    });

    expect(result).toEqual({ status: "ready", taskSkeletonJson: "{}" });
    expect(decompose).toHaveBeenCalledWith(
      expect.objectContaining({
        problem_spec_json: expect.stringContaining(
          "Clarification: Which quarter? Answer: Q3 2026",
        ),
      }),
    );
    expect(rows[0]!.status).toBe("ready");
    expect(rows[0]!.goal_state_json.pendingQuestions).toEqual({});

    await expect(
      service.resumeAfterClarification({
        tenantId: "ten_00000000-0000-7000-8000-00000000000a",
        workspaceId: "ws_a",
        conversationId: "cnv_a",
        runId: "run_a",
        originalObjective: "summarize the quarterly report",
        mode: "workflow",
      }),
    ).rejects.toThrow(ClarificationLoopValidationError);
    expect(decompose).toHaveBeenCalledTimes(1);
  });

  it("keeps unanswered questions durable and does not plan from a partial answer", async () => {
    const answeredId = "clr_answered";
    const unansweredId = "clr_unanswered";
    const { store, rows } = createFakeStore([
      {
        tenant_id: "00000000-0000-7000-8000-00000000000a",
        conversation_id: "cnv_a",
        goal_state_json: {
          pendingClarifications: { [answeredId]: "Q3 2026" },
          pendingQuestions: {
            [answeredId]: "Which quarter?",
            [unansweredId]: "Which format?",
          },
          taskSkeletonJson: null,
        },
        status: "awaiting_clarification",
        revision: 1,
      },
    ]);
    const decompose = vi.fn(async () => ({
      task_skeleton_json: "{}",
      ambiguity_detected: false,
      clarification_questions: [],
    }));
    const service = new ClarificationLoopService(store, fakePlanner({ decompose }));

    const result = await service.resumeAfterClarification({
      tenantId: "ten_00000000-0000-7000-8000-00000000000a",
      workspaceId: "ws_a",
      conversationId: "cnv_a",
      runId: "run_a",
      originalObjective: "summarize the quarterly report",
      mode: "workflow",
    });

    expect(result).toEqual({
      status: "awaiting_clarification",
      questions: [{ clarificationId: unansweredId, question: "Which format?" }],
    });
    expect(rows[0]!.goal_state_json.pendingQuestions).toEqual({
      [answeredId]: "Which quarter?",
      [unansweredId]: "Which format?",
    });
    expect(decompose).not.toHaveBeenCalled();
  });

  it("restores claimed questions after Planner failure so resume can retry", async () => {
    const clarificationId = "clr_test";
    const { store, rows } = createFakeStore([
      {
        tenant_id: "00000000-0000-7000-8000-00000000000a",
        conversation_id: "cnv_a",
        goal_state_json: {
          pendingClarifications: { [clarificationId]: "Q3 2026" },
          pendingQuestions: { [clarificationId]: "Which quarter?" },
          taskSkeletonJson: null,
        },
        status: "awaiting_clarification",
        revision: 1,
      },
    ]);
    const decompose = vi
      .fn()
      .mockRejectedValueOnce(new Error("Planner unavailable"))
      .mockResolvedValueOnce({
        task_skeleton_json: "{}",
        ambiguity_detected: false,
        clarification_questions: [],
      });
    const service = new ClarificationLoopService(store, fakePlanner({ decompose }));
    const request = {
      tenantId: "ten_00000000-0000-7000-8000-00000000000a",
      workspaceId: "ws_a",
      conversationId: "cnv_a",
      runId: "run_a",
      originalObjective: "summarize the quarterly report",
      mode: "workflow" as const,
    };

    await expect(service.resumeAfterClarification(request)).rejects.toThrow("Planner unavailable");
    expect(rows[0]).toMatchObject({
      status: "awaiting_clarification",
      goal_state_json: { pendingQuestions: { [clarificationId]: "Which quarter?" } },
    });
    await expect(service.resumeAfterClarification(request)).resolves.toEqual({
      status: "ready",
      taskSkeletonJson: "{}",
    });
    expect(decompose).toHaveBeenCalledTimes(2);
  });

  it("rejects when there are no answered outstanding questions yet", async () => {
    const { store } = createFakeStore([
      {
        tenant_id: "00000000-0000-7000-8000-00000000000a",
        conversation_id: "cnv_a",
        goal_state_json: {
          pendingClarifications: {},
          pendingQuestions: { clr_test: "Which quarter?" },
          taskSkeletonJson: null,
        },
        status: "awaiting_clarification",
        revision: 1,
      },
    ]);
    const service = new ClarificationLoopService(store, fakePlanner());

    await expect(
      service.resumeAfterClarification({
        tenantId: "ten_00000000-0000-7000-8000-00000000000a",
        workspaceId: "ws_a",
        conversationId: "cnv_a",
        runId: "run_a",
        originalObjective: "summarize the quarterly report",
        mode: "workflow",
      }),
    ).rejects.toThrow(ClarificationLoopValidationError);
  });

  it("can surface fresh questions again if the resumed decompose is still ambiguous", async () => {
    const clarificationId = "clr_first";
    const { store, rows } = createFakeStore([
      {
        tenant_id: "00000000-0000-7000-8000-00000000000a",
        conversation_id: "cnv_a",
        goal_state_json: {
          pendingClarifications: { [clarificationId]: "Q3 2026" },
          pendingQuestions: { [clarificationId]: "Which quarter?" },
          taskSkeletonJson: null,
        },
        status: "awaiting_clarification",
        revision: 1,
      },
    ]);
    const planner = fakePlanner({
      decompose: vi.fn(async () => ({
        task_skeleton_json: "{}",
        ambiguity_detected: true,
        clarification_questions: ["Which output format do you want?"],
      })),
    });
    const service = new ClarificationLoopService(store, planner);

    const result = await service.resumeAfterClarification({
      tenantId: "ten_00000000-0000-7000-8000-00000000000a",
      workspaceId: "ws_a",
      conversationId: "cnv_a",
      runId: "run_a",
      originalObjective: "summarize the quarterly report",
      mode: "workflow",
    });

    expect(result.status).toBe("awaiting_clarification");
    expect(rows[0]!.status).toBe("awaiting_clarification");
    // The claimed answer is no longer outstanding; only fresh questions remain.
    expect(Object.keys(rows[0]!.goal_state_json.pendingQuestions ?? {})).toHaveLength(1);
  });
});
