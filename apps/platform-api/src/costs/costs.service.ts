import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  CostLedgerClient,
  type CostMode,
  type CostSource,
  type EngineCallerContext,
} from "../engine";
import type { ActorContext } from "../rbac/types";
import { CostsHttpError } from "./problem";
import type { CostEstimate, CostSummary, EstimateCostInput } from "./types";

const allowedDimensions = ["mode", "source", "provider", "resource"] as const;
const allowedSources = [
  "model_gateway",
  "tool_gateway",
  "sandbox",
  "storage",
  "browser",
] as const;

@Injectable()
export class CostsService {
  constructor(private readonly costs: CostLedgerClient) {}

  async summary(
    query: unknown,
    actor: ActorContext | undefined,
    traceparent: string | undefined,
  ): Promise<CostSummary> {
    const instance = "/api/v1/costs/summary";
    const parsed = parseSummaryQuery(query, instance);
    const rollupsJson = await this.costs.getSummary(
      parsed,
      callerContext(actor, traceparent, instance),
    );
    return parseSummary(rollupsJson, instance);
  }

  estimate(
    input: unknown,
    actor: ActorContext | undefined,
    traceparent: string | undefined,
  ): Promise<CostEstimate> {
    const instance = "/api/v1/costs/estimate";
    return this.costs.estimate(
      parseEstimate(input, instance),
      callerContext(actor, traceparent, instance),
    );
  }
}

function parseSummaryQuery(
  value: unknown,
  instance: string,
): { startAt: string; endAt: string; dimensions: string[] } {
  if (!isRecord(value)) throw invalidRequest(instance, "Query parameters required");
  const startAt = requiredString(value.startAt, instance, "startAt");
  const endAt = requiredString(value.endAt, instance, "endAt");
  const startTime = Date.parse(startAt);
  const endTime = Date.parse(endAt);
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime <= startTime) {
    throw invalidRequest(instance, "startAt and endAt must be ordered ISO 8601 timestamps");
  }
  const dimensions = value.dimensions === undefined
    ? []
    : Array.isArray(value.dimensions)
      ? value.dimensions
      : [value.dimensions];
  if (!dimensions.every(isDimension)) {
    throw invalidRequest(instance, "dimensions contains an unsupported value");
  }
  return { startAt, endAt, dimensions };
}

function parseEstimate(value: unknown, instance: string): EstimateCostInput {
  if (!isRecord(value) || !isCostMode(value.mode) || !Array.isArray(value.lineItems)) {
    throw invalidRequest(instance, "mode and lineItems are required");
  }
  if (value.lineItems.length === 0 || !value.lineItems.every(isEstimateLineItem)) {
    throw invalidRequest(instance, "lineItems must contain valid cost inputs");
  }
  return {
    mode: value.mode,
    lineItems: value.lineItems,
  };
}

function parseSummary(value: string, instance: string): CostSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidUpstreamSummary(instance);
  }
  if (!isRollupResponse(parsed)) throw invalidUpstreamSummary(instance);
  return {
    startAt: parsed.start_at,
    endAt: parsed.end_at,
    currency: parsed.currency,
    dimensions: parsed.dimensions,
    groups: parsed.groups.map((group) => ({
      dimensions: group.dimensions,
      internalCostMinor: group.internal_cost_minor,
      retryCostMinor: group.retry_cost_minor,
      recoveryCostMinor: group.recovery_cost_minor,
      billableMinor: group.billable_minor,
      marginMinor: group.margin_minor,
      eventCount: group.event_count,
    })),
    totals: {
      internalCostMinor: parsed.totals.internal_cost_minor,
      billableMinor: parsed.totals.billable_minor,
      marginMinor: parsed.totals.margin_minor,
    },
  };
}

function callerContext(
  actor: ActorContext | undefined,
  traceparent: string | undefined,
  instance: string,
): EngineCallerContext {
  if (!actor) {
    throw new CostsHttpError(401, "AUTHENTICATION_REQUIRED", "Authenticated actor required", instance);
  }
  if (!actor.workspace_id) {
    throw new CostsHttpError(403, "COST_WORKSPACE_REQUIRED", "Workspace context required", instance);
  }
  return {
    userId: actor.user_id,
    tenantId: actor.tenant_id,
    workspaceId: actor.workspace_id,
    sessionId: actor.session_id,
    authTime: actor.auth_time ?? Math.floor(Date.now() / 1000),
    roles: actor.roles,
    permissions: actor.permissions,
    traceparent: validTraceparent(traceparent) ? traceparent : newTraceparent(),
  };
}

function isRollupResponse(value: unknown): value is {
  start_at: string;
  end_at: string;
  currency: "INR" | "USD";
  dimensions: string[];
  groups: Array<{
    dimensions: Record<string, string>;
    internal_cost_minor: string;
    retry_cost_minor: string;
    recovery_cost_minor: string;
    billable_minor: string;
    margin_minor: string;
    event_count: number;
  }>;
  totals: { internal_cost_minor: string; billable_minor: string; margin_minor: string };
} {
  return (
    isRecord(value) &&
    typeof value.start_at === "string" &&
    typeof value.end_at === "string" &&
    (value.currency === "INR" || value.currency === "USD") &&
    Array.isArray(value.dimensions) && value.dimensions.every(isDimension) &&
    Array.isArray(value.groups) && value.groups.every(isRollupGroup) &&
    isRollupTotals(value.totals)
  );
}

function isRollupGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringRecord(value.dimensions) &&
    isMinor(value.internal_cost_minor) && isMinor(value.retry_cost_minor) &&
    isMinor(value.recovery_cost_minor) && isMinor(value.billable_minor) &&
    isMinor(value.margin_minor) &&
    typeof value.event_count === "number" && Number.isSafeInteger(value.event_count) && value.event_count >= 0
  );
}

function isRollupTotals(value: unknown): boolean {
  return isRecord(value) && isMinor(value.internal_cost_minor) && isMinor(value.billable_minor) && isMinor(value.margin_minor);
}

function isEstimateLineItem(value: unknown): value is {
  source: CostSource;
  provider: string;
  resource: string;
  expectedQuantity: number;
} {
  return isRecord(value) && isCostSource(value.source) &&
    typeof value.provider === "string" && value.provider.length > 0 &&
    typeof value.resource === "string" && value.resource.length > 0 &&
    typeof value.expectedQuantity === "number" && Number.isFinite(value.expectedQuantity) && value.expectedQuantity > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isMinor(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isDimension(value: unknown): value is (typeof allowedDimensions)[number] {
  return typeof value === "string" && allowedDimensions.includes(value as (typeof allowedDimensions)[number]);
}

function isCostSource(value: unknown): value is CostSource {
  return typeof value === "string" && allowedSources.includes(value as CostSource);
}

function isCostMode(value: unknown): value is CostMode {
  return value === "workflow" || value === "project";
}

function requiredString(value: unknown, instance: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw invalidRequest(instance, `${field} is required`);
  return value;
}

function invalidRequest(instance: string, detail: string): CostsHttpError {
  return new CostsHttpError(400, "INVALID_COST_REQUEST", detail, instance);
}

function invalidUpstreamSummary(instance: string): CostsHttpError {
  return new CostsHttpError(502, "INVALID_COST_ROLLUP_RESPONSE", "Cost ledger returned an invalid summary", instance);
}

function validTraceparent(value: string | undefined): value is string {
  return typeof value === "string" && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[01]$/i.test(value);
}

function newTraceparent(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}
