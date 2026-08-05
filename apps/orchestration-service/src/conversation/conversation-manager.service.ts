import { randomUUID } from "node:crypto";

import type {
  ConversationClassifyIntentRequest,
  ConversationClassifyIntentResponse,
  ConversationGetGoalStateRequest,
  ConversationGetGoalStateResponse,
  ConversationMergeClarificationRequest,
  ConversationMergeClarificationResponse,
} from "@alterx/contracts";
import type { ConversationHandler, ModelGatewayHandler } from "@alterx/adapters";
import { PromptInjectionClassifier } from "@alterx/auth";

import {
  INTENT_VALUES,
  emptyGoalState,
  isActionableIntent,
  isIntent,
  type GoalState,
  type GoalStateStatus,
} from "./intent-taxonomy";

export class ConversationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationValidationError";
  }
}

export class ConversationClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationClassificationError";
  }
}

export class ConversationConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationConcurrencyError";
  }
}

// Retry budget for mergeClarification's optimistic-concurrency loop -- see
// the class doc comment on ConversationManagerService for why this exists.
const MAX_MERGE_ATTEMPTS = 5;

const TENANT_ID_PATTERN =
  /^ten_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// conversation.proto's tenant_id fields are ten_-prefixed (see
// alter/conversation/v1/conversation.proto), but every DB column and
// OrchestrationTenantStore.withTenant() expect a bare UUID -- discovered
// via the Planning-phase exit check exercising this against a real
// PostgresOrchestrationStoreProvider for the first time; no existing test
// used a real store, so this mismatch was never caught. Matches the same
// bareTenantUuid() pattern graph-compiler.service.ts already established.
function bareTenantUuid(tenantId: string): string {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new ConversationValidationError("tenant_id must be a ten_ prefixed UUIDv7");
  }
  return tenantId.slice("ten_".length);
}

const CLASSIFICATION_SYSTEM_PROMPT = `You classify a single user utterance into exactly one intent from this fixed set: ${INTENT_VALUES.join(", ")}.
- "answer": the user wants information back; nothing should change.
- "plan": the user wants a plan created toward some goal.
- "workflow": the user wants an existing workflow run.
- "execute": the user wants something performed right now.
- "modify": the user wants an existing thing changed.
Respond with strict JSON only, no prose, no markdown fences: {"intent": "<one value from the set above>", "confidence": <number between 0 and 1>}.`;

interface ModelGatewayOutputEnvelope {
  readonly message: { readonly role: string; readonly content: string };
  readonly stop_reason: string;
}

interface ClassificationCandidate {
  readonly intent?: unknown;
  readonly confidence?: unknown;
}

interface GoalStateRow {
  readonly goalState: GoalState;
  readonly status: GoalStateStatus;
  readonly revision: number;
}

function requireNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw new ConversationValidationError(`${field} is required`);
  }
}

function prefixedUuidV7(prefix: "run" | "node"): `${typeof prefix}_${string}` {
  const uuid = randomUUID();
  return `${prefix}_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}

function parseJsonOrThrow<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ConversationClassificationError(
      `Model Gateway returned invalid JSON for ${context}`,
    );
  }
}

function parseClassificationResponse(
  outputJson: string,
): ConversationClassifyIntentResponse {
  const envelope = parseJsonOrThrow<ModelGatewayOutputEnvelope>(
    outputJson,
    "output_json envelope",
  );
  if (typeof envelope.message?.content !== "string") {
    throw new ConversationClassificationError(
      "Model Gateway output_json is missing message.content",
    );
  }

  const candidate = parseJsonOrThrow<ClassificationCandidate>(
    envelope.message.content,
    "classification content",
  );
  if (typeof candidate.intent !== "string" || !isIntent(candidate.intent)) {
    throw new ConversationClassificationError(
      `Model Gateway returned an unrecognized intent: ${JSON.stringify(candidate.intent)}`,
    );
  }
  if (
    typeof candidate.confidence !== "number" ||
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    throw new ConversationClassificationError(
      "Model Gateway returned an invalid confidence score",
    );
  }

  const intent = candidate.intent;
  return {
    intent,
    confidence: candidate.confidence,
    actionable: isActionableIntent(intent),
  };
}

interface OrchestrationTransactionLike {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

// Structural subset of PostgresOrchestrationStoreProvider -- narrowed so
// tests can pass a plain fake object instead of a real provider instance
// (the real class has private fields, which TS won't let a plain object
// literal structurally satisfy).
export interface OrchestrationTenantStore {
  withTenant<T>(
    tenantId: string,
    operation: (tx: OrchestrationTransactionLike) => Promise<T>,
  ): Promise<T>;
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

// Classifies utterances against the fixed intent taxonomy, tracks each
// conversation's goal state (one row per conversation, upserted lazily on
// first clarification), and merges clarification answers back into that
// state.
//
// mergeClarification uses optimistic concurrency (a bounded read-modify-
// write retry loop keyed on `revision`, matching the column the proto
// contract already exposes) rather than a row lock, so concurrent
// MergeClarification calls for the same conversation never silently lose
// an update -- a losing writer re-reads the row a caller's UPDATE just
// committed and retries its own merge on top of it. MAX_MERGE_ATTEMPTS
// bounds retries under pathological contention; exhausting it throws
// ConversationConcurrencyError rather than looping forever.
export class ConversationManagerService implements ConversationHandler {
  readonly #promptInjectionClassifier: PromptInjectionClassifier;

  constructor(
    private readonly store: OrchestrationTenantStore,
    private readonly modelGateway: ModelGatewayHandler,
  ) {
    this.#promptInjectionClassifier = new PromptInjectionClassifier(modelGateway);
  }

  async classifyIntent(
    request: ConversationClassifyIntentRequest,
  ): Promise<ConversationClassifyIntentResponse> {
    requireNonEmpty("tenant_id", request.tenant_id);
    requireNonEmpty("conversation_id", request.conversation_id);
    requireNonEmpty("utterance", request.utterance);

    const promptInjection = await this.#promptInjectionClassifier.classify({
      tenantId: request.tenant_id,
      runId: prefixedUuidV7("run"),
      nodeExecutionId: prefixedUuidV7("node"),
      text: request.utterance,
    });
    if (promptInjection.blocked) {
      throw new ConversationValidationError(
        promptInjection.reason ?? "Prompt injection attempt detected",
      );
    }

    const invokeResponse = await this.modelGateway.invoke({
      tenant_id: request.tenant_id,
      // ClassifyIntent has no natural run/node -- it's an ad-hoc Model
      // Gateway call, not part of a workflow execution. Synthesized here
      // solely so the Model Gateway's required cost/audit attribution
      // fields are populated.
      run_id: prefixedUuidV7("run"),
      node_execution_id: prefixedUuidV7("node"),
      model_alias: "FAST",
      input_json: JSON.stringify({
        messages: [
          { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
          { role: "user", content: request.utterance },
        ],
      }),
    });

    return parseClassificationResponse(invokeResponse.output_json);
  }

  async getGoalState(
    request: ConversationGetGoalStateRequest,
  ): Promise<ConversationGetGoalStateResponse> {
    requireNonEmpty("tenant_id", request.tenant_id);
    requireNonEmpty("conversation_id", request.conversation_id);
    const bareTenant = bareTenantUuid(request.tenant_id);

    return this.store.withTenant(bareTenant, async (tx) => {
      const row = await readGoalStateRow(
        tx,
        bareTenant,
        request.conversation_id,
      );
      // No goal state has been created for this conversation yet (no
      // clarification has ever been merged into it). Rather than erroring,
      // this returns a default empty state at revision 0 -- GetGoalState
      // is read-only and idempotent either way, and a conversation with no
      // goal state yet is a completely ordinary condition (e.g. right
      // after ClassifyIntent, before any clarification is needed).
      if (row === undefined) {
        return {
          goal_state_json: JSON.stringify(emptyGoalState()),
          status: "planning",
          revision: 0,
        };
      }
      return {
        goal_state_json: JSON.stringify(row.goalState),
        status: row.status,
        revision: row.revision,
      };
    });
  }

  async mergeClarification(
    request: ConversationMergeClarificationRequest,
  ): Promise<ConversationMergeClarificationResponse> {
    requireNonEmpty("tenant_id", request.tenant_id);
    requireNonEmpty("conversation_id", request.conversation_id);
    requireNonEmpty("clarification_id", request.clarification_id);
    const bareTenant = bareTenantUuid(request.tenant_id);

    return this.store.withTenant(bareTenant, async (tx) => {
      await tx.query(
        `INSERT INTO conversation_goal_states (tenant_id, conversation_id)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, conversation_id) DO NOTHING`,
        [bareTenant, request.conversation_id],
      );

      for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt += 1) {
        const row = await readGoalStateRow(
          tx,
          bareTenant,
          request.conversation_id,
        );
        if (row === undefined) {
          throw new Error(
            "conversation_goal_states row missing immediately after upsert",
          );
        }

        const nextGoalState: GoalState = {
          ...row.goalState,
          pendingClarifications: {
            ...row.goalState.pendingClarifications,
            [request.clarification_id]: request.answer,
          },
        };

        const result = await tx.query<{
          goal_state_json: GoalState;
          revision: number;
        }>(
          `UPDATE conversation_goal_states
           SET goal_state_json = $1, revision = revision + 1, updated_at = now()
           WHERE tenant_id = $2 AND conversation_id = $3 AND revision = $4
           RETURNING goal_state_json, revision`,
          [
            JSON.stringify(nextGoalState),
            bareTenant,
            request.conversation_id,
            row.revision,
          ],
        );

        if (result.rowCount === 1) {
          await tx.query(
            `UPDATE clarifications
             SET status = CASE
                   WHEN expiry_at < clock_timestamp() THEN 'expired'
                   ELSE 'answered'
                 END,
                 answered_at = CASE
                   WHEN expiry_at < clock_timestamp() THEN NULL
                   ELSE clock_timestamp()
                 END
             WHERE tenant_id = $1 AND conversation_id = $2 AND id = $3 AND status = 'open'`,
            [bareTenant, request.conversation_id, request.clarification_id],
          );
          const updated = result.rows[0]!;
          return {
            goal_state_json: JSON.stringify(updated.goal_state_json),
            revision: updated.revision,
          };
        }
        // rowCount === 0 means another concurrent MergeClarification
        // committed first and changed the revision out from under us --
        // loop and retry against the now-current row.
      }

      throw new ConversationConcurrencyError(
        `mergeClarification exceeded ${MAX_MERGE_ATTEMPTS} retry attempts under concurrent writes for conversation ${request.conversation_id}`,
      );
    });
  }
}
