import { describe, expect, it, vi } from "vitest";

import type { ModelGatewayHandler } from "@alterx/adapters";
import type { ModelgwInvokeRequest, ModelgwInvokeResponse } from "@alterx/contracts";

import {
  ConversationConcurrencyError,
  ConversationManagerService,
  ConversationValidationError,
  type OrchestrationTenantStore,
} from "./conversation-manager.service";
import { INTENT_VALUES, emptyGoalState, type GoalState } from "./intent-taxonomy";

interface FakeRow {
  goal_state_json: GoalState;
  status: string;
  revision: number;
}

function rowKey(tenantId: string, conversationId: string): string {
  return `${tenantId}:${conversationId}`;
}

function createFakeStore(seed: Record<string, FakeRow> = {}): {
  readonly store: OrchestrationTenantStore;
  readonly rows: Map<string, FakeRow>;
} {
  const rows = new Map<string, FakeRow>(Object.entries(seed));

  const store: OrchestrationTenantStore = {
    async withTenant(_tenantId, operation) {
      return operation({
        async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
          statement: string,
          values: readonly unknown[] = [],
        ) {
          const sql = statement.trim();
          if (sql.startsWith("SELECT")) {
            const [tenantId, conversationId] = values as [string, string];
            const row = rows.get(rowKey(tenantId, conversationId));
            return {
              rowCount: row === undefined ? 0 : 1,
              rows: (row === undefined ? [] : [row]) as unknown as readonly TRow[],
            };
          }
          if (sql.startsWith("INSERT")) {
            const [tenantId, conversationId] = values as [string, string];
            const key = rowKey(tenantId, conversationId);
            if (!rows.has(key)) {
              rows.set(key, {
                goal_state_json: emptyGoalState(),
                status: "planning",
                revision: 0,
              });
            }
            return { rowCount: 1, rows: [] as unknown as readonly TRow[] };
          }
          if (sql.startsWith("UPDATE")) {
            const [json, tenantId, conversationId, expectedRevision] = values as [
              string,
              string,
              string,
              number,
            ];
            const key = rowKey(tenantId, conversationId);
            const row = rows.get(key);
            if (row === undefined || row.revision !== expectedRevision) {
              return { rowCount: 0, rows: [] as unknown as readonly TRow[] };
            }
            const updated: FakeRow = {
              goal_state_json: JSON.parse(json) as GoalState,
              status: row.status,
              revision: row.revision + 1,
            };
            rows.set(key, updated);
            return {
              rowCount: 1,
              rows: [updated] as unknown as readonly TRow[],
            };
          }
          throw new Error(`unexpected SQL in fake store: ${sql}`);
        },
      });
    },
  };

  return { store, rows };
}

function classificationInvoke(
  intent: string,
  confidence = 0.9,
): (request: ModelgwInvokeRequest) => Promise<ModelgwInvokeResponse> {
  return async () => ({
    output_json: JSON.stringify({
      message: {
        role: "assistant",
        content: JSON.stringify({ intent, confidence }),
      },
      stop_reason: "end_turn",
    }),
    usage_json: JSON.stringify({ input_tokens: 10, output_tokens: 5 }),
    resolved_capability: "FAST:mock",
  });
}

function fakeModelGateway(
  invoke: ModelGatewayHandler["invoke"],
): ModelGatewayHandler {
  return { invoke };
}

const TENANT_A = "ten_a";
const TENANT_B = "ten_b";
const CONVERSATION = "cnv_1";

describe("ConversationManagerService.classifyIntent", () => {
  it.each(INTENT_VALUES)("classifies an utterance as %s", async (intent) => {
    const { store } = createFakeStore();
    const invoke = vi.fn(classificationInvoke(intent));
    const service = new ConversationManagerService(store, fakeModelGateway(invoke));

    const response = await service.classifyIntent({
      tenant_id: TENANT_A,
      workspace_id: "ws_1",
      conversation_id: CONVERSATION,
      utterance: "utterance for " + intent,
    });

    expect(response.intent).toBe(intent);
    expect(response.confidence).toBe(0.9);
    expect(response.actionable).toBe(intent !== "answer");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_A,
        model_alias: "FAST",
      }),
    );
  });

  it("sends the utterance and system prompt as FAST-tier chat messages", async () => {
    const { store } = createFakeStore();
    const invoke = vi.fn(classificationInvoke("plan"));
    const service = new ConversationManagerService(store, fakeModelGateway(invoke));

    await service.classifyIntent({
      tenant_id: TENANT_A,
      workspace_id: "ws_1",
      conversation_id: CONVERSATION,
      utterance: "build me a workflow",
    });

    const sent = invoke.mock.calls[0]![0];
    const parsedInput = JSON.parse(sent.input_json) as {
      messages: { role: string; content: string }[];
    };
    expect(parsedInput.messages).toEqual([
      { role: "system", content: expect.stringContaining("plan") },
      { role: "user", content: "build me a workflow" },
    ]);
  });

  it("rejects an empty utterance", async () => {
    const { store } = createFakeStore();
    const service = new ConversationManagerService(
      store,
      fakeModelGateway(vi.fn()),
    );

    await expect(
      service.classifyIntent({
        tenant_id: TENANT_A,
        workspace_id: "ws_1",
        conversation_id: CONVERSATION,
        utterance: "  ",
      }),
    ).rejects.toThrow(ConversationValidationError);
  });

  it("throws when the model returns an unrecognized intent", async () => {
    const { store } = createFakeStore();
    const service = new ConversationManagerService(
      store,
      fakeModelGateway(classificationInvoke("delete_everything")),
    );

    await expect(
      service.classifyIntent({
        tenant_id: TENANT_A,
        workspace_id: "ws_1",
        conversation_id: CONVERSATION,
        utterance: "do something",
      }),
    ).rejects.toThrow(/unrecognized intent/);
  });
});

describe("ConversationManagerService.getGoalState", () => {
  it("returns a default empty state at revision 0 for a not-yet-created conversation", async () => {
    const { store } = createFakeStore();
    const service = new ConversationManagerService(store, fakeModelGateway(vi.fn()));

    const response = await service.getGoalState({
      tenant_id: TENANT_A,
      conversation_id: CONVERSATION,
    });

    expect(response).toEqual({
      goal_state_json: JSON.stringify(emptyGoalState()),
      status: "planning",
      revision: 0,
    });
  });

  it("returns the existing row for a conversation with goal state", async () => {
    const existingState: GoalState = { pendingClarifications: { clr_1: "yes" } };
    const { store } = createFakeStore({
      [rowKey(TENANT_A, CONVERSATION)]: {
        goal_state_json: existingState,
        status: "awaiting_clarification",
        revision: 3,
      },
    });
    const service = new ConversationManagerService(store, fakeModelGateway(vi.fn()));

    const response = await service.getGoalState({
      tenant_id: TENANT_A,
      conversation_id: CONVERSATION,
    });

    expect(response).toEqual({
      goal_state_json: JSON.stringify(existingState),
      status: "awaiting_clarification",
      revision: 3,
    });
  });

  it("never returns another tenant's goal state for the same conversation id", async () => {
    const tenantBState: GoalState = { pendingClarifications: { clr_secret: "tenant-b-only" } };
    const { store } = createFakeStore({
      [rowKey(TENANT_B, CONVERSATION)]: {
        goal_state_json: tenantBState,
        status: "ready",
        revision: 7,
      },
    });
    const service = new ConversationManagerService(store, fakeModelGateway(vi.fn()));

    const response = await service.getGoalState({
      tenant_id: TENANT_A,
      conversation_id: CONVERSATION,
    });

    expect(response).toEqual({
      goal_state_json: JSON.stringify(emptyGoalState()),
      status: "planning",
      revision: 0,
    });
  });
});

describe("ConversationManagerService.mergeClarification", () => {
  it("creates a goal state row on first merge and starts revision at 1", async () => {
    const { store } = createFakeStore();
    const service = new ConversationManagerService(store, fakeModelGateway(vi.fn()));

    const response = await service.mergeClarification({
      tenant_id: TENANT_A,
      conversation_id: CONVERSATION,
      clarification_id: "clr_1",
      answer: "yes",
    });

    expect(response.revision).toBe(1);
    expect(JSON.parse(response.goal_state_json)).toEqual({
      pendingClarifications: { clr_1: "yes" },
    });
  });

  it("merges a second clarification alongside the first and increments revision again", async () => {
    const { store } = createFakeStore();
    const service = new ConversationManagerService(store, fakeModelGateway(vi.fn()));

    await service.mergeClarification({
      tenant_id: TENANT_A,
      conversation_id: CONVERSATION,
      clarification_id: "clr_1",
      answer: "yes",
    });
    const second = await service.mergeClarification({
      tenant_id: TENANT_A,
      conversation_id: CONVERSATION,
      clarification_id: "clr_2",
      answer: "no",
    });

    expect(second.revision).toBe(2);
    expect(JSON.parse(second.goal_state_json)).toEqual({
      pendingClarifications: { clr_1: "yes", clr_2: "no" },
    });
  });

  it("retries once and succeeds when a concurrent writer commits between read and write", async () => {
    const { store, rows } = createFakeStore({
      [rowKey(TENANT_A, CONVERSATION)]: {
        goal_state_json: { pendingClarifications: {} },
        status: "planning",
        revision: 0,
      },
    });
    // Simulate a concurrent writer: bump the row's revision directly
    // between when the service reads it and when it issues its UPDATE, by
    // wrapping the store's withTenant once to mutate mid-flight.
    let firstCall = true;
    const racingStore: OrchestrationTenantStore = {
      async withTenant(tenantId, operation) {
        return store.withTenant(tenantId, async (tx) => {
          return operation({
            query: async (statement, values = []) => {
              if (statement.trim().startsWith("SELECT") && firstCall) {
                firstCall = false;
                // A concurrent transaction commits here, in between this
                // read and the caller's own UPDATE.
                rows.set(rowKey(TENANT_A, CONVERSATION), {
                  goal_state_json: { pendingClarifications: { clr_other: "already merged" } },
                  status: "planning",
                  revision: 1,
                });
              }
              return tx.query(statement, values);
            },
          });
        });
      },
    };
    const racingService = new ConversationManagerService(
      racingStore,
      fakeModelGateway(vi.fn()),
    );

    const response = await racingService.mergeClarification({
      tenant_id: TENANT_A,
      conversation_id: CONVERSATION,
      clarification_id: "clr_mine",
      answer: "mine",
    });

    // The losing first attempt's revision=0 UPDATE must not have applied;
    // the retry picks up the concurrent writer's committed row and merges
    // on top of it -- both clarifications must be present, and revision
    // reflects two real writes (the concurrent one + this retry), not a
    // lost update.
    expect(response.revision).toBe(2);
    expect(JSON.parse(response.goal_state_json)).toEqual({
      pendingClarifications: { clr_other: "already merged", clr_mine: "mine" },
    });
  });

  it("throws ConversationConcurrencyError when retries are exhausted", async () => {
    const { store } = createFakeStore({
      [rowKey(TENANT_A, CONVERSATION)]: {
        goal_state_json: { pendingClarifications: {} },
        status: "planning",
        revision: 0,
      },
    });

    // A store whose UPDATE always reports a conflict (0 rows), simulating
    // permanent contention.
    const alwaysConflictingStore: OrchestrationTenantStore = {
      async withTenant(tenantId, operation) {
        return store.withTenant(tenantId, async (tx) => {
          return operation({
            query: async (statement, values = []) => {
              if (statement.trim().startsWith("UPDATE")) {
                return { rowCount: 0, rows: [] };
              }
              return tx.query(statement, values);
            },
          });
        });
      },
    };

    const conflictingService = new ConversationManagerService(
      alwaysConflictingStore,
      fakeModelGateway(vi.fn()),
    );

    await expect(
      conflictingService.mergeClarification({
        tenant_id: TENANT_A,
        conversation_id: CONVERSATION,
        clarification_id: "clr_1",
        answer: "yes",
      }),
    ).rejects.toThrow(ConversationConcurrencyError);
  });

  it("never merges into another tenant's goal state row", async () => {
    const { store, rows } = createFakeStore({
      [rowKey(TENANT_B, CONVERSATION)]: {
        goal_state_json: { pendingClarifications: { clr_b: "tenant-b-only" } },
        status: "planning",
        revision: 0,
      },
    });
    const service = new ConversationManagerService(store, fakeModelGateway(vi.fn()));

    const response = await service.mergeClarification({
      tenant_id: TENANT_A,
      conversation_id: CONVERSATION,
      clarification_id: "clr_a",
      answer: "tenant-a-only",
    });

    expect(JSON.parse(response.goal_state_json)).toEqual({
      pendingClarifications: { clr_a: "tenant-a-only" },
    });
    expect(rows.get(rowKey(TENANT_B, CONVERSATION))).toEqual({
      goal_state_json: { pendingClarifications: { clr_b: "tenant-b-only" } },
      status: "planning",
      revision: 0,
    });
  });

  it("rejects an empty clarification_id", async () => {
    const { store } = createFakeStore();
    const service = new ConversationManagerService(store, fakeModelGateway(vi.fn()));

    await expect(
      service.mergeClarification({
        tenant_id: TENANT_A,
        conversation_id: CONVERSATION,
        clarification_id: "",
        answer: "yes",
      }),
    ).rejects.toThrow(ConversationValidationError);
  });
});
