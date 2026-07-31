import {
  CostIdSchema,
  IsoTimestampSchema,
  NodeExecutionIdSchema,
  RunIdSchema,
  TenantIdSchema,
  type CostIngestCostEventRequest,
  type CostIngestCostEventResponse,
} from "@alterx/contracts";
import type { RunsHandlerClient } from "@alterx/adapters";

const KNOWN_SOURCES = new Set(["model_gateway", "sandbox", "browser"]);

export class CostValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostValidationError";
  }
}

/**
 * `tool_gateway` and `storage` are real, CHECK-allowed sources (OUT-1's
 * schema anticipates them) but have no real emitter yet -- Tool Gateway and
 * ads-core's storage path don't publish cost events (disclosed follow-up,
 * not this ticket's scope). Nothing sends these sources today, so failing
 * closed here is honest rather than guessing at a usage_json shape that
 * doesn't exist yet.
 */
export class CostUnrecognizedSourceError extends Error {
  constructor(source: string) {
    super(`No ingestion rule for cost event source: ${source}`);
    this.name = "CostUnrecognizedSourceError";
  }
}

interface DerivedUsage {
  readonly resource: string;
  readonly quantity: string;
  readonly unit: string;
}

interface CostQueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> {
  readonly rowCount: number;
  readonly rows: readonly TRow[];
}

export interface CostEventTransaction {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<CostQueryResult<TRow>>;
}

export interface CostEventStore {
  withTenant<T>(
    tenantId: string,
    operation: (transaction: CostEventTransaction) => Promise<T>,
  ): Promise<T>;
}

/**
 * Real implementation of cost.proto's CostService.IngestCostEvent (OUT-4).
 * Resolves workspace_id via the Run Lookup Service (cost_db must not join
 * across orchestration_db's boundary, doc 04 SS1), derives the schema's
 * required fields from the event's usage_json/amount_json, and inserts an
 * idempotent cost_events row.
 */
export class CostIngestService {
  constructor(
    private readonly store: CostEventStore,
    private readonly runsClient: RunsHandlerClient,
  ) {}

  async ingestCostEvent(
    request: CostIngestCostEventRequest,
  ): Promise<CostIngestCostEventResponse> {
    const tenantId = requireSchema(TenantIdSchema, request.tenant_id, "tenant_id");
    const costEventId = requireSchema(CostIdSchema, request.cost_event_id, "cost_event_id");
    const runId = requireSchema(RunIdSchema, request.run_id, "run_id");
    const nodeExecutionId = requireSchema(
      NodeExecutionIdSchema,
      request.node_execution_id,
      "node_execution_id",
    );
    const occurredAt = requireSchema(IsoTimestampSchema, request.occurred_at, "occurred_at");
    if (!KNOWN_SOURCES.has(request.source)) {
      throw new CostUnrecognizedSourceError(request.source);
    }
    const usage = deriveUsage(request.source, request.usage_json);
    const internalCostMinor = deriveInternalCostMinorUsd(request.amount_json);

    const { workspace_id: workspaceId } = await this.runsClient.getRunWorkspace({
      tenant_id: tenantId,
      run_id: runId,
    });
    // OUT-5: real is_retry/is_recovery, derived from the node execution's
    // real attempt counter + whether a recovery_actions row exists for it
    // -- previously always hardcoded false (no signal existed at all).
    const { is_retry: isRetry, is_recovery: isRecovery } =
      await this.runsClient.getNodeExecutionRecoveryInfo({
        tenant_id: tenantId,
        run_id: runId,
        node_execution_id: nodeExecutionId,
      });

    await this.store.withTenant(bareTenantUuid(tenantId), async (tx) => {
      await tx.query(
        `INSERT INTO cost_events (
           id, tenant_id, workspace_id, mode, parent_id, run_id, node_execution_id,
           source, provider, resource, quantity, unit, internal_cost_minor, currency,
           is_retry, is_recovery, occurred_at
         )
         SELECT $1, $2, $3, 'workflow', NULL, $4, $5, $6, $7, $8, $9, $10, $11, 'USD',
                $13, $14, $12
         WHERE NOT EXISTS (SELECT 1 FROM cost_events WHERE id = $1)`,
        [
          bareCostEventUuid(costEventId),
          bareTenantUuid(tenantId),
          bareWorkspaceUuid(workspaceId),
          bareRunUuid(runId),
          bareNodeExecutionUuid(nodeExecutionId),
          request.source,
          request.provider_reference,
          usage.resource,
          usage.quantity,
          usage.unit,
          internalCostMinor,
          occurredAt,
          isRetry,
          isRecovery,
        ],
      );
    });

    return { accepted: true };
  }
}

function deriveUsage(source: string, usageJson: string): DerivedUsage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(usageJson);
  } catch {
    throw new CostValidationError("usage_json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CostValidationError("usage_json must parse to an object");
  }
  const usage = parsed as Record<string, unknown>;

  if (source === "model_gateway") {
    const inputTokens = usage["input_tokens"];
    const outputTokens = usage["output_tokens"];
    if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
      throw new CostValidationError(
        "model_gateway usage_json must have numeric input_tokens/output_tokens",
      );
    }
    return {
      resource: "tokens",
      quantity: String(inputTokens + outputTokens),
      unit: "tokens",
    };
  }

  // sandbox | browser (both share the Sandbox Service's usage_json shape)
  const resourceType = usage["resource_type"];
  const units = usage["units"];
  if (typeof resourceType !== "string" || typeof units !== "number") {
    throw new CostValidationError(
      "sandbox/browser usage_json must have string resource_type and numeric units",
    );
  }
  return { resource: resourceType, quantity: String(units), unit: "invocations" };
}

/**
 * amount_json.usd is a USD float (see model-gateway's ESTIMATED_USD_PER_TOKEN
 * comment: not billing-accurate). internal_cost_minor is stored in USD cents
 * with currency='USD' explicitly -- no fabricated USD->INR conversion rate;
 * a real FX-rate provider is a disclosed follow-up, not invented here.
 */
function deriveInternalCostMinorUsd(amountJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(amountJson);
  } catch {
    throw new CostValidationError("amount_json is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CostValidationError("amount_json must parse to an object");
  }
  const usd = (parsed as Record<string, unknown>)["usd"];
  if (typeof usd !== "number" || usd < 0) {
    throw new CostValidationError("amount_json.usd must be a non-negative number");
  }
  return String(Math.round(usd * 100));
}

function requireSchema(
  schema: { safeParse: (value: string) => { success: boolean } },
  value: string,
  field: string,
): string {
  if (!schema.safeParse(value).success) {
    throw new CostValidationError(`Invalid ${field}: ${value}`);
  }
  return value;
}

// cost_events' id/tenant_id/workspace_id/run_id/node_execution_id columns
// are all Postgres `uuid` type (OUT-1's schema) -- app-layer prefixed ids
// (cst_/ten_/ws_/run_/node_) must be stripped before insert or the uuid
// cast fails.
function bareCostEventUuid(costEventId: string): string {
  return costEventId.slice("cst_".length);
}

function bareTenantUuid(tenantId: string): string {
  return tenantId.slice("ten_".length);
}

function bareWorkspaceUuid(workspaceId: string): string {
  return workspaceId.slice("ws_".length);
}

function bareRunUuid(runId: string): string {
  return runId.slice("run_".length);
}

function bareNodeExecutionUuid(nodeExecutionId: string): string {
  return nodeExecutionId.slice("node_".length);
}
