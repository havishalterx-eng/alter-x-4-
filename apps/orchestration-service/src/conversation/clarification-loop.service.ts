import { randomUUID } from "node:crypto";

import type { PlannerHandler } from "@alterx/adapters";

import {
  emptyGoalState,
  type GoalState,
  type GoalStateStatus,
} from "./intent-taxonomy";

export class ClarificationLoopValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarificationLoopValidationError";
  }
}

export class ClarificationLoopConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarificationLoopConcurrencyError";
  }
}

const MAX_UPDATE_ATTEMPTS = 5;

interface OrchestrationTransactionLike {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

// Local copy of the OrchestrationTenantStore interface, matching the
// established per-module convention (conversation-manager.service.ts,
// trigger-registry.service.ts each keep their own copy rather than
// sharing one) -- keeps this module self-contained.
export interface OrchestrationTenantStore {
  withTenant<T>(
    tenantId: string,
    operation: (tx: OrchestrationTransactionLike) => Promise<T>,
  ): Promise<T>;
}

interface GoalStateRow {
  readonly goalState: GoalState;
  readonly status: GoalStateStatus;
  readonly revision: number;
}

async function readGoalStateRow(
  tx: OrchestrationTransactionLike,
  tenantId: string,
  conversationId: string,
): Promise<GoalStateRow | undefined> {
  const result = await tx.query<{
    goal_state_json: GoalState;
    status: string;
    revision: number;
  }>(
    `SELECT goal_state_json, status, revision
     FROM conversation_goal_states
     WHERE tenant_id = $1 AND conversation_id = $2`,
    [tenantId, conversationId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    goalState: row.goal_state_json,
    status: row.status as GoalStateStatus,
    revision: row.revision,
  };
}

function requireNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw new ClarificationLoopValidationError(`${field} is required`);
  }
}

function prefixedUuidV7(prefix: "clr"): string {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}

const TENANT_ID_PATTERN =
  /^ten_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// request.tenantId is ten_-prefixed (it's forwarded straight to
// PlannerHandler.decompose/selectStrategy, whose contract requires that
// prefix), but OrchestrationTenantStore.withTenant() and every DB column
// expect a bare UUID. Same mismatch class fixed in
// conversation-manager.service.ts's bareTenantUuid() -- found via the
// Planning-phase exit check running this against a real
// PostgresOrchestrationStoreProvider for the first time.
function bareTenantUuid(tenantId: string): string {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new ClarificationLoopValidationError("tenantId must be a ten_ prefixed UUIDv7");
  }
  return tenantId.slice("ten_".length);
}

export interface RequestPlanRequest {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly objective: string;
  readonly mode: string;
}

export interface OutstandingQuestion {
  readonly clarificationId: string;
  readonly question: string;
}

export type RequestPlanResult =
  | {
      readonly status: "ready";
      readonly taskSkeletonJson: string;
    }
  | {
      readonly status: "awaiting_clarification";
      readonly questions: readonly OutstandingQuestion[];
    };

export interface ResumeAfterClarificationRequest {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly originalObjective: string;
  readonly mode: string;
}

// Orchestrates the Planner (PLAN-3, HTTP) and the Conversation Manager's
// goal-state machine (INGR-4) into one loop: pause on ambiguity, surface
// minimal questions, and (once mergeClarification -- INGR-4, unchanged --
// has recorded an answer) resume planning with that answer folded back
// into the objective.
//
// Nothing calls this over the network yet -- same as PLAN-3's Decompose/
// Replan/SelectStrategy and PLAN-6's resolve_node_requirements, this is a
// pure importable service for a not-yet-built caller (the real conversation
// workflow integration) to wire in later. ConversationService's proto has
// no RequestPlan RPC; adding one is a contracts change outside this
// ticket's scope.
export class ClarificationLoopService {
  constructor(
    private readonly store: OrchestrationTenantStore,
    private readonly planner: PlannerHandler,
  ) {}

  async requestPlan(request: RequestPlanRequest): Promise<RequestPlanResult> {
    requireNonEmpty("tenantId", request.tenantId);
    requireNonEmpty("workspaceId", request.workspaceId);
    requireNonEmpty("conversationId", request.conversationId);
    requireNonEmpty("runId", request.runId);
    requireNonEmpty("objective", request.objective);
    requireNonEmpty("mode", request.mode);

    const { strategy } = await this.planner.selectStrategy({
      tenant_id: request.tenantId,
      objective: request.objective,
      mode: request.mode,
    });
    const problemSpec = await this.planner.understand({
      tenant_id: request.tenantId,
      workspace_id: request.workspaceId,
      run_id: request.runId,
      objective: request.objective,
    });

    const decomposed = await this.planner.decompose({
      tenant_id: request.tenantId,
      workspace_id: request.workspaceId,
      run_id: request.runId,
      strategy,
      problem_spec_json: JSON.stringify(problemSpec),
    });

    const bareTenant = bareTenantUuid(request.tenantId);

    if (decomposed.ambiguity_detected && decomposed.clarification_questions.length > 0) {
      const questions: OutstandingQuestion[] = decomposed.clarification_questions.map(
        (question) => ({ clarificationId: prefixedUuidV7("clr"), question }),
      );
      await this.updateGoalState(
        bareTenant,
        request.conversationId,
        (current) => ({
          goalState: {
            ...current,
            pendingQuestions: {
              ...current.pendingQuestions,
              ...Object.fromEntries(questions.map((q) => [q.clarificationId, q.question])),
            },
          },
          status: "awaiting_clarification",
        }),
        async (tx) => {
          for (const question of questions) {
            const inserted = await tx.query(
              `INSERT INTO clarifications
                 (id, tenant_id, workspace_id, conversation_id, question, status, expiry_at)
               SELECT $1, $2, workspace_id, $3, $4, 'open',
                      clock_timestamp() + make_interval(secs => 86400)
               FROM conversations
               WHERE tenant_id = $2 AND id = $3`,
              [question.clarificationId, bareTenant, request.conversationId, question.question],
            );
            if (inserted.rowCount !== 1) {
              throw new ClarificationLoopValidationError(
                `conversation ${request.conversationId} was not found for this tenant`,
              );
            }
          }
        },
      );
      return { status: "awaiting_clarification", questions };
    }

    await this.updateGoalState(bareTenant, request.conversationId, (current) => ({
      goalState: { ...current, taskSkeletonJson: decomposed.task_skeleton_json },
      status: "ready",
    }));
    return { status: "ready", taskSkeletonJson: decomposed.task_skeleton_json };
  }

  // Call after ConversationManagerService.mergeClarification has recorded
  // the answer for a given clarificationId. Folds every outstanding
  // question this call resolves into a revised objective and re-invokes
  // the Planner. Still-ambiguous results surface fresh questions the same
  // way requestPlan does -- callers loop by answering and calling this
  // again, there is no internal retry bound because each iteration
  // requires a real human answer in between.
  async resumeAfterClarification(
    request: ResumeAfterClarificationRequest,
  ): Promise<RequestPlanResult> {
    requireNonEmpty("tenantId", request.tenantId);
    requireNonEmpty("workspaceId", request.workspaceId);
    requireNonEmpty("conversationId", request.conversationId);
    requireNonEmpty("runId", request.runId);
    requireNonEmpty("originalObjective", request.originalObjective);
    requireNonEmpty("mode", request.mode);

    const bareTenant = bareTenantUuid(request.tenantId);
    const goalState = await this.store.withTenant(bareTenant, (tx) =>
      readGoalStateRow(tx, bareTenant, request.conversationId),
    );
    const current = goalState?.goalState ?? emptyGoalState();

    const answeredQuestions = Object.entries(current.pendingQuestions ?? {}).filter(
      ([clarificationId]) => clarificationId in (current.pendingClarifications ?? {}),
    );
    if (answeredQuestions.length === 0) {
      throw new ClarificationLoopValidationError(
        "no answered outstanding questions found for this conversation",
      );
    }

    const revisedObjective = [
      request.originalObjective,
      ...answeredQuestions.map(
        ([clarificationId, question]) =>
          `Clarification: ${question} Answer: ${current.pendingClarifications[clarificationId]}`,
      ),
    ].join("\n\n");

    return this.requestPlan({
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      conversationId: request.conversationId,
      runId: request.runId,
      objective: revisedObjective,
      mode: request.mode,
    });
  }

  private async updateGoalState(
    tenantId: string,
    conversationId: string,
    next: (current: GoalState) => { goalState: GoalState; status: GoalStateStatus },
    afterUpdate?: (tx: OrchestrationTransactionLike) => Promise<void>,
  ): Promise<void> {
    await this.store.withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO conversation_goal_states (tenant_id, conversation_id)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, conversation_id) DO NOTHING`,
        [tenantId, conversationId],
      );

      for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt += 1) {
        const row = await readGoalStateRow(tx, tenantId, conversationId);
        if (row === undefined) {
          throw new Error(
            "conversation_goal_states row missing immediately after upsert",
          );
        }

        const { goalState: nextGoalState, status: nextStatus } = next(row.goalState);

        const result = await tx.query(
          `UPDATE conversation_goal_states
           SET goal_state_json = $1, status = $2, revision = revision + 1, updated_at = now()
           WHERE tenant_id = $3 AND conversation_id = $4 AND revision = $5`,
          [JSON.stringify(nextGoalState), nextStatus, tenantId, conversationId, row.revision],
        );

        if (result.rowCount === 1) {
          await afterUpdate?.(tx);
          return;
        }
      }

      throw new ClarificationLoopConcurrencyError(
        `updateGoalState exceeded ${MAX_UPDATE_ATTEMPTS} retry attempts under concurrent writes for conversation ${conversationId}`,
      );
    });
  }
}
