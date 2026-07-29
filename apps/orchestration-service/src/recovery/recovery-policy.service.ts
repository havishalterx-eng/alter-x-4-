import {
  FailureObservationSchema,
  NodeExecutionIdSchema,
  RecoveryActionIdSchema,
  RootCauseEstimateSchema,
  RunIdSchema,
  TenantIdSchema,
  type FailureObservation,
  type RecoveryClassifyFailureRequest,
  type RecoveryClassifyFailureResponse,
  type RootCauseEstimate,
} from "@alterx/contracts";
import type { ModelGatewayHandler } from "@alterx/adapters";

import {
  classifyNodeFailure,
  type FailureClassification,
} from "./failure-classifier";
import { createRecoveryActionId } from "./recovery-action-id";

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

export class RecoveryPolicyService {
  readonly #mintRecoveryActionId: () => string;

  constructor(
    private readonly store: RecoveryTenantStore,
    private readonly modelGateway: ModelGatewayHandler,
    mintRecoveryActionId: () => string = createRecoveryActionId,
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
    if (row === undefined || row.status !== "failed" || row.error === null) {
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
