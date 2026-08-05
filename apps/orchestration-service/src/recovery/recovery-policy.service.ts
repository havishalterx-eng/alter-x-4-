import {
  FailureClassSchema,
  FailureObservationSchema,
  NodeExecutionIdSchema,
  RecoveryActionIdSchema,
  RootCauseEstimateSchema,
  RunIdSchema,
  TenantIdSchema,
  type FailureObservation,
  type RecoveryClassifyFailureRequest,
  type RecoveryClassifyFailureResponse,
  type RecoveryRecordOutcomeRequest,
  type RecoveryRecordOutcomeResponse,
  type RecoverySelectStrategyRequest,
  type RecoverySelectStrategyResponse,
  type RootCauseEstimate,
} from "@alterx/contracts";
import type { ModelGatewayHandler, PolicyStoreHandler } from "@alterx/adapters";

import {
  classifyNodeFailure,
  type FailureClassification,
} from "./failure-classifier";
import { createRecoveryActionId } from "./recovery-action-id";
import type { EscalationsService } from "../escalations/escalations.service";
import type { RecoveryDispatchService } from "./recovery-dispatch.service";
import {
  POLICY_ID,
  parsePolicyRules,
  selectRecoveryStrategy,
  type ActivePolicy,
  type RecoveryStrategy,
} from "./recovery-strategy-table";

/** The one real (kind, scope) this table has ever consulted -- matches
 * migration 0002's seed exactly. A tenant/workspace-scoped override for
 * this same kind is possible per the schema, but no ticket has built one
 * yet; `tenant_id` is passed through so a future one is already wired. */
const RECOVERY_POLICY_KIND = "recovery_preferences";

interface RecoveryTransaction {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

export interface RecoveryTenantStore {
  withTenant<T>(
    tenantId: string,
    operation: (transaction: RecoveryTransaction) => Promise<T>,
  ): Promise<T>;
}

interface FailedNodeRow extends Record<string, unknown> {
  readonly id: string;
  readonly node_type: string;
  readonly attempt: number;
  readonly status: string;
  readonly error: Record<string, unknown> | null;
}

interface PendingRecoveryRow extends Record<string, unknown> {
  readonly failure_class: string;
  readonly root_cause_estimate: unknown;
}

interface ModelRootCauseOutput {
  readonly explanation: string;
  readonly confidence: number;
  readonly evidence: readonly string[];
}

export class RecoveryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryValidationError";
  }
}

export class RecoveryNodeNotFoundError extends Error {
  constructor(nodeExecutionId: string) {
    super(`Failed node execution ${nodeExecutionId} was not found`);
    this.name = "RecoveryNodeNotFoundError";
  }
}

export class RecoveryRootCauseUnavailableError extends Error {
  constructor(options: ErrorOptions = {}) {
    super("ADVANCED root-cause estimation failed", options);
    this.name = "RecoveryRootCauseUnavailableError";
  }
}

export class RecoveryPersistenceConflictError extends Error {
  constructor(nodeExecutionId: string) {
    super(`Pending recovery classification for ${nodeExecutionId} could not be persisted`);
    this.name = "RecoveryPersistenceConflictError";
  }
}

export class RecoveryActionNotFoundError extends Error {
  constructor(recoveryActionId: string) {
    super(`Recovery action ${recoveryActionId} was not found`);
    this.name = "RecoveryActionNotFoundError";
  }
}

export class RecoveryActionNotClassifiedError extends Error {
  constructor(nodeExecutionId: string) {
    super(`No pending classification exists for node execution ${nodeExecutionId}`);
    this.name = "RecoveryActionNotClassifiedError";
  }
}

export class RecoveryPolicyService {
  readonly #mintRecoveryActionId: () => string;

  constructor(
    private readonly store: RecoveryTenantStore,
    private readonly modelGateway: ModelGatewayHandler,
    private readonly dispatch: RecoveryDispatchService,
    mintRecoveryActionId: () => string = createRecoveryActionId,
    private readonly policyStoreClient?: PolicyStoreHandler,
    private readonly escalations?: EscalationsService,
  ) {
    this.#mintRecoveryActionId = mintRecoveryActionId;
  }

  async classifyFailure(
    request: RecoveryClassifyFailureRequest,
  ): Promise<RecoveryClassifyFailureResponse> {
    const tenantId = parsePrefixedId(
      TenantIdSchema,
      request.tenant_id,
      "tenant_id must be a ten_ prefixed UUIDv7",
    );
    parsePrefixedId(
      RunIdSchema,
      request.run_id,
      "run_id must be a run_ prefixed UUIDv7",
    );
    parsePrefixedId(
      NodeExecutionIdSchema,
      request.node_execution_id,
      "node_execution_id must be a node_ prefixed UUIDv7",
    );
    const observation = parseObservation(request.error_json);
    const bareTenantId = tenantId.slice("ten_".length);
    const node = await this.#loadFailedNode(bareTenantId, request);
    const existing = await this.#loadPending(bareTenantId, request);
    if (existing !== undefined) return responseFromEstimate(existing);

    const classification = classifyNodeFailure(
      {
        nodeType: node.node_type,
        attempt: node.attempt,
        error: node.error ?? {},
      },
      observation,
    );
    const estimate = await this.#estimateRootCause(
      request,
      node,
      observation,
      classification,
    );
    return this.#persist(
      bareTenantId,
      request,
      classification.failureClass,
      estimate,
    );
  }

  async selectStrategy(
    request: RecoverySelectStrategyRequest,
  ): Promise<RecoverySelectStrategyResponse> {
    const tenantId = parsePrefixedId(
      TenantIdSchema,
      request.tenant_id,
      "tenant_id must be a ten_ prefixed UUIDv7",
    );
    parsePrefixedId(RunIdSchema, request.run_id, "run_id must be a run_ prefixed UUIDv7");
    parsePrefixedId(
      NodeExecutionIdSchema,
      request.node_execution_id,
      "node_execution_id must be a node_ prefixed UUIDv7",
    );
    const failureClass = parsePrefixedId(
      FailureClassSchema,
      request.failure_class,
      "failure_class must be one of the locked FailureClassSchema values",
    );
    const estimate = parseRootCauseEstimateJson(request.root_cause_estimate_json);
    if (estimate.failure_class !== failureClass) {
      throw new RecoveryValidationError(
        "failure_class does not match root_cause_estimate_json.failure_class",
      );
    }
    const bareTenantId = tenantId.slice("ten_".length);

    // Idempotency law for this ticket: a strategy already chosen AND
    // already dispatched-to-completion (outcome set) is a true no-op
    // replay. But a strategy chosen with no outcome yet means a prior call
    // crashed between #persistStrategy and #persistOutcome -- that must
    // RESUME dispatch with the SAME strategy (never re-decide), not
    // silently pretend it already ran. Treating "strategy set" alone as
    // "done" would let a chosen strategy sit forever, never dispatched.
    const existing = await this.#loadDecided(bareTenantId, request);
    if (existing !== undefined && existing.outcome !== null) {
      return existing.response;
    }

    let recoveryActionId: string;
    let strategy: RecoveryStrategy;
    let policyVersion: string;
    if (existing !== undefined) {
      recoveryActionId = existing.response.recovery_action_id;
      strategy = existing.response.strategy as RecoveryStrategy;
      policyVersion = existing.response.policy_version;
    } else {
      const activePolicy = await this.#loadActivePolicyBestEffort(bareTenantId);
      const decision = selectRecoveryStrategy(
        failureClass,
        estimate.node_attempt,
        activePolicy,
      );
      recoveryActionId = await this.#persistStrategy(bareTenantId, request, decision);
      strategy = decision.strategy;
      policyVersion = decision.policyVersion;
    }

    // Only "degrade" needs the failed node's real DAG key (to find its
    // predecessors) -- skip the extra query for the other 7 dispatchable
    // strategies, which never read it.
    const nodeKey =
      strategy === "degrade"
        ? await this.#loadNodeKey(bareTenantId, request.run_id, request.node_execution_id)
        : "";

    const dispatchResult = await this.dispatch.dispatch(strategy, {
      tenantId: bareTenantId,
      runId: request.run_id,
      nodeExecutionId: request.node_execution_id,
      nodeKey,
      failureClass,
      estimate,
    });
    await this.#persistOutcome(
      bareTenantId,
      recoveryActionId,
      request.run_id,
      strategy,
      dispatchResult.outcome,
    );

    return {
      recovery_action_id: recoveryActionId,
      strategy,
      policy_id: POLICY_ID,
      policy_version: policyVersion,
    };
  }

  async recordOutcome(
    request: RecoveryRecordOutcomeRequest,
  ): Promise<RecoveryRecordOutcomeResponse> {
    const tenantId = parsePrefixedId(
      TenantIdSchema,
      request.tenant_id,
      "tenant_id must be a ten_ prefixed UUIDv7",
    );
    parsePrefixedId(RunIdSchema, request.run_id, "run_id must be a run_ prefixed UUIDv7");
    const recoveryActionId = parsePrefixedId(
      RecoveryActionIdSchema,
      request.recovery_action_id,
      "recovery_action_id must be a rec_ prefixed UUIDv7",
    );
    const outcome = parseOutcomeValue(request.outcome);
    const bareTenantId = tenantId.slice("ten_".length);

    const updatedRow = await this.store.withTenant(bareTenantId, async (tx) => {
      const result = await tx.query<{
        readonly id: string;
        readonly node_execution_id: string | null;
        readonly failure_class: string;
      }>(
        `UPDATE recovery_actions
         SET outcome = $1, resolved_at = clock_timestamp()
         WHERE tenant_id = $2 AND id = $3 AND run_id = $4
           AND strategy = $5 AND strategy IS NOT NULL
         RETURNING id, node_execution_id, failure_class`,
        [outcome, bareTenantId, recoveryActionId, request.run_id, request.strategy],
      );
      return result.rows[0];
    });
    if (updatedRow === undefined) throw new RecoveryActionNotFoundError(recoveryActionId);

    // Real HAC escalation queue entry (Product Core Phase's real
    // /api/v1/escalations, previously a dead scaffold with no Engine
    // backing) -- best-effort: a failure here must never make the
    // already-real, already-committed recovery_actions write look like it
    // failed too. escalations is optional (nullable DI) for callers/tests
    // that don't need it wired.
    if (outcome === "escalated" && this.escalations) {
      try {
        await this.escalations.create({
          tenantId,
          runId: request.run_id,
          nodeExecutionId: updatedRow.node_execution_id ?? undefined,
          recoveryActionId,
          reason: `Recovery strategy "${request.strategy}" (${updatedRow.failure_class}) was exhausted and needs human attention`,
        });
      } catch {
        // Disclosed, real limitation: the recovery outcome is already
        // durably recorded above; a failure creating the escalation row
        // means this instance won't appear in the real HAC queue, not
        // that the recovery attempt itself was lost.
      }
    }
    return { recorded: true };
  }

  /**
   * Real Policy Store read, best-effort: memory-service being unreachable,
   * slow, or simply having no active `recovery_preferences` policy yet
   * must never block a recovery decision -- `selectRecoveryStrategy`
   * already falls back to its deterministic table when `undefined` comes
   * back, exactly as if this client didn't exist. No `policyStoreClient`
   * configured at all (constructor default) also returns `undefined`
   * immediately, no network call attempted.
   */
  async #loadActivePolicyBestEffort(tenantId: string): Promise<ActivePolicy | undefined> {
    if (this.policyStoreClient === undefined) {
      return undefined;
    }
    try {
      const response = await this.policyStoreClient.getActivePolicy({
        tenant_id: `ten_${tenantId}`,
        kind: RECOVERY_POLICY_KIND,
      });
      if (!response.found || response.policy_id === null || response.body_json === null) {
        return undefined;
      }
      return {
        policyId: response.policy_id,
        policyVersion: String(response.version ?? ""),
        rules: parsePolicyRules(response.body_json),
      };
    } catch {
      // Best-effort: fall back to the deterministic table, same contract
      // as the rest of this codebase's #xBestEffort methods.
      return undefined;
    }
  }

  async #loadDecided(
    tenantId: string,
    request: RecoverySelectStrategyRequest,
  ): Promise<
    { readonly response: RecoverySelectStrategyResponse; readonly outcome: string | null }
    | undefined
  > {
    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{
        readonly id: string;
        readonly strategy: string | null;
        readonly policy_version: string | null;
        readonly outcome: string | null;
      }>(
        `SELECT id, strategy, policy_version, outcome FROM recovery_actions
         WHERE tenant_id = $1 AND run_id = $2 AND node_execution_id = $3
           AND failure_class = $4
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, request.run_id, request.node_execution_id, request.failure_class],
      );
      const row = result.rows[0];
      if (row === undefined || row.strategy === null || row.policy_version === null) {
        return undefined;
      }
      return {
        response: {
          recovery_action_id: row.id,
          strategy: row.strategy,
          policy_id: POLICY_ID,
          policy_version: row.policy_version,
        },
        outcome: row.outcome,
      };
    });
  }

  async #persistStrategy(
    tenantId: string,
    request: RecoverySelectStrategyRequest,
    decision: ReturnType<typeof selectRecoveryStrategy>,
  ): Promise<string> {
    const updated = await this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{ readonly id: string }>(
        `UPDATE recovery_actions
         SET strategy = $1, policy_version = $2
         WHERE tenant_id = $3 AND run_id = $4 AND node_execution_id = $5
           AND failure_class = $6 AND strategy IS NULL
         RETURNING id`,
        [
          decision.strategy,
          decision.policyVersion,
          tenantId,
          request.run_id,
          request.node_execution_id,
          request.failure_class,
        ],
      );
      return result.rows[0]?.id;
    });
    if (updated !== undefined) return updated;

    // Lost a race, or classifyFailure was never called for this node.
    const existing = await this.#loadDecided(tenantId, request);
    if (existing === undefined) {
      throw new RecoveryActionNotClassifiedError(request.node_execution_id);
    }
    return existing.response.recovery_action_id;
  }

  async #persistOutcome(
    tenantId: string,
    recoveryActionId: string,
    runId: string,
    strategy: string,
    outcome: string,
  ): Promise<void> {
    await this.store.withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE recovery_actions
         SET outcome = $1, resolved_at = clock_timestamp()
         WHERE tenant_id = $2 AND id = $3 AND run_id = $4 AND strategy = $5
           AND outcome IS NULL`,
        [outcome, tenantId, recoveryActionId, runId, strategy],
      );
    });
  }

  async #loadNodeKey(
    tenantId: string,
    runId: string,
    nodeExecutionId: string,
  ): Promise<string> {
    const row = await this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{ readonly dag_node_id: string }>(
        "SELECT dag_node_id FROM node_executions WHERE tenant_id = $1 AND run_id = $2 AND id = $3",
        [tenantId, runId, nodeExecutionId],
      );
      return result.rows[0];
    });
    if (row === undefined) {
      throw new RecoveryNodeNotFoundError(nodeExecutionId);
    }
    return row.dag_node_id;
  }

  async #loadFailedNode(
    tenantId: string,
    request: RecoveryClassifyFailureRequest,
  ): Promise<FailedNodeRow> {
    const row = await this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<FailedNodeRow>(
        `SELECT id, node_type, attempt, status, error
         FROM node_executions
         WHERE tenant_id = $1 AND run_id = $2 AND id = $3`,
        [tenantId, request.run_id, request.node_execution_id],
      );
      return result.rows[0];
    });
    if (
      row === undefined ||
      (row.status !== "failed" && row.status !== "blocked_pending_recovery") ||
      row.error === null
    ) {
      throw new RecoveryNodeNotFoundError(request.node_execution_id);
    }
    return row;
  }

  async #loadPending(
    tenantId: string,
    request: RecoveryClassifyFailureRequest,
  ): Promise<RootCauseEstimate | undefined> {
    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<PendingRecoveryRow>(
        `SELECT failure_class, root_cause_estimate
         FROM recovery_actions
         WHERE tenant_id = $1 AND run_id = $2 AND node_execution_id = $3
           AND strategy IS NULL
         LIMIT 1`,
        [tenantId, request.run_id, request.node_execution_id],
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;
      const estimate = RootCauseEstimateSchema.safeParse(row.root_cause_estimate);
      if (!estimate.success || estimate.data.failure_class !== row.failure_class) {
        throw new RecoveryPersistenceConflictError(request.node_execution_id);
      }
      return estimate.data;
    });
  }

  async #estimateRootCause(
    request: RecoveryClassifyFailureRequest,
    node: FailedNodeRow,
    observation: FailureObservation,
    classification: FailureClassification,
  ): Promise<RootCauseEstimate> {
    try {
      const response = await this.modelGateway.invoke({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_execution_id: request.node_execution_id,
        model_alias: "ADVANCED",
        input_json: JSON.stringify({
          task: "Estimate root cause only. Do not select or recommend a recovery strategy.",
          output_schema: {
            explanation: "non-empty string",
            confidence: "number from 0 to 1",
            evidence: "array of 1 to 8 non-empty strings",
          },
          deterministic_classification: {
            failure_class: classification.failureClass,
            confidence_ceiling: classification.confidenceCeiling,
            evidence: classification.evidence,
          },
          node_execution: {
            node_type: node.node_type,
            attempt: node.attempt,
            error: safeError(node.error ?? {}),
          },
          observation,
        }),
      });
      if (!response.resolved_capability.startsWith("ADVANCED:")) {
        throw new Error("Model Gateway did not resolve ADVANCED tier");
      }
      const modelOutput = parseModelOutput(response.output_json);
      return RootCauseEstimateSchema.parse({
        schema_version: "heal5.v1",
        failure_class: classification.failureClass,
        explanation: modelOutput.explanation,
        confidence: Math.min(
          modelOutput.confidence,
          classification.confidenceCeiling,
        ),
        evidence: modelOutput.evidence,
        node_attempt: node.attempt,
        model_alias: "ADVANCED",
        resolved_capability: response.resolved_capability,
      });
    } catch (error: unknown) {
      throw new RecoveryRootCauseUnavailableError({ cause: error });
    }
  }

  async #persist(
    tenantId: string,
    request: RecoveryClassifyFailureRequest,
    failureClass: string,
    estimate: RootCauseEstimate,
  ): Promise<RecoveryClassifyFailureResponse> {
    const recoveryActionId = this.#mintRecoveryActionId();
    if (!RecoveryActionIdSchema.safeParse(recoveryActionId).success) {
      throw new RecoveryValidationError(
        "mintRecoveryActionId must return a rec_ prefixed UUIDv7",
      );
    }
    const inserted = await this.store.withTenant(tenantId, async (tx) =>
      tx.query(
        `INSERT INTO recovery_actions
           (id, tenant_id, run_id, node_execution_id, failure_class,
            root_cause_estimate, strategy, policy_version)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL, NULL)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          recoveryActionId,
          tenantId,
          request.run_id,
          request.node_execution_id,
          failureClass,
          JSON.stringify(estimate),
        ],
      ),
    );
    if (inserted.rowCount === 1) return responseFromEstimate(estimate);
    const winner = await this.#loadPending(tenantId, request);
    if (winner === undefined) {
      throw new RecoveryPersistenceConflictError(request.node_execution_id);
    }
    return responseFromEstimate(winner);
  }
}

function parseObservation(errorJson: string): FailureObservation {
  let value: unknown;
  try {
    value = JSON.parse(errorJson);
  } catch (error: unknown) {
    throw new RecoveryValidationError(
      `error_json is not valid JSON: ${(error as Error).message}`,
    );
  }
  const parsed = FailureObservationSchema.safeParse(value);
  if (!parsed.success) {
    throw new RecoveryValidationError(
      "error_json must match FailureObservationSchema with prefixed UUIDv7 trace_id/request_id",
    );
  }
  return parsed.data;
}

function parseRootCauseEstimateJson(json: string): RootCauseEstimate {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error: unknown) {
    throw new RecoveryValidationError(
      `root_cause_estimate_json is not valid JSON: ${(error as Error).message}`,
    );
  }
  const parsed = RootCauseEstimateSchema.safeParse(value);
  if (!parsed.success) {
    throw new RecoveryValidationError(
      "root_cause_estimate_json must match the locked RootCauseEstimateSchema",
    );
  }
  return parsed.data;
}

function parseOutcomeValue(outcome: string): "resolved" | "failed" | "escalated" {
  if (outcome === "resolved" || outcome === "failed" || outcome === "escalated") {
    return outcome;
  }
  throw new RecoveryValidationError(
    'outcome must be one of "resolved", "failed", "escalated"',
  );
}

function parsePrefixedId<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    throw new RecoveryValidationError(message);
  }
  return parsed.data;
}

function parseModelOutput(outputJson: string): ModelRootCauseOutput {
  const parsed = JSON.parse(outputJson) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("root-cause output must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      "confidence,evidence,explanation" ||
    typeof record["explanation"] !== "string" ||
    record["explanation"].trim().length === 0 ||
    record["explanation"].length > 2_048 ||
    typeof record["confidence"] !== "number" ||
    !Number.isFinite(record["confidence"]) ||
    record["confidence"] < 0 ||
    record["confidence"] > 1 ||
    !Array.isArray(record["evidence"]) ||
    record["evidence"].length < 1 ||
    record["evidence"].length > 8 ||
    !record["evidence"].every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.length <= 512,
    )
  ) {
    throw new Error("root-cause output does not match required structured shape");
  }
  return {
    explanation: record["explanation"],
    confidence: record["confidence"],
    evidence: record["evidence"] as string[],
  };
}

function safeError(
  error: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | boolean>> {
  const safe: Record<string, string | boolean> = {};
  for (const key of ["code", "error_code", "detail", "message"] as const) {
    const value = error[key];
    if (typeof value === "string" && value.trim().length > 0) {
      safe[key] = value.slice(0, 2_048);
    }
  }
  if (typeof error["retryable"] === "boolean") {
    safe["retryable"] = error["retryable"];
  }
  return safe;
}

function responseFromEstimate(
  estimate: RootCauseEstimate,
): RecoveryClassifyFailureResponse {
  return {
    failure_class: estimate.failure_class,
    confidence: estimate.confidence,
    root_cause_estimate_json: JSON.stringify(estimate),
  };
}
