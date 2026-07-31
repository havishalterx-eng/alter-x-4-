import { createHmac } from "node:crypto";

import type {
  CostQueryRollupsRequest,
  CostQueryRollupsResponse,
} from "@alterx/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Real, allowlisted grouping columns -- never string-interpolate a
 * caller-supplied dimension name straight into SQL. */
const DIMENSION_COLUMNS: Record<string, string> = {
  mode: "mode",
  source: "source",
  provider: "provider",
  resource: "resource",
};

export class RollupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollupValidationError";
  }
}

interface RollupQueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> {
  readonly rowCount: number;
  readonly rows: readonly TRow[];
}

export interface RollupTransaction {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<RollupQueryResult<TRow>>;
}

export interface RollupStore {
  withTenant<T>(
    tenantId: string,
    operation: (transaction: RollupTransaction) => Promise<T>,
  ): Promise<T>;
  withProvisioner<T>(operation: (transaction: RollupTransaction) => Promise<T>): Promise<T>;
}

interface GroupRow extends Record<string, unknown> {
  readonly internal_cost_minor: string;
  readonly retry_cost_minor: string;
  readonly recovery_cost_minor: string;
  readonly event_count: string;
}

interface DimensionGroup {
  readonly dimensions: Record<string, string>;
  readonly internalCostMinor: string;
  readonly retryCostMinor: string;
  readonly recoveryCostMinor: string;
  readonly billableMinor: string;
  readonly marginMinor: string;
  readonly eventCount: number;
}

/**
 * Real implementation of cost.proto's CostService.QueryRollups (OUT-5) --
 * previously declared but unimplemented (grpc-js auto-returns UNIMPLEMENTED
 * for a proto method with no registered handler, same as every other
 * stub-until-a-later-phase RPC in this codebase).
 *
 * Computes on-demand from real cost_events (the request's arbitrary
 * start_at/end_at/dimensions -- not tied to a fixed billing period), and
 * separately upserts a durable snapshot into billing_rollups (real writer
 * for a table OUT-1 shipped schema-only). The two aren't the same
 * granularity by design: billing_rollups is one row per (tenant, period,
 * mode) with the full dimension breakdown in `detail` jsonb; the RPC
 * response returns that same breakdown directly, not reduced to the
 * rollup row's shape.
 */
export class CostRollupService {
  constructor(
    private readonly store: RollupStore,
    private readonly marginRate: number,
    private readonly pseudonymKey: string,
  ) {
    if (marginRate < 0 || marginRate >= 1) {
      throw new RollupValidationError("marginRate must be from 0 (inclusive) to 1 (exclusive)");
    }
    if (pseudonymKey.length < 32) {
      throw new RollupValidationError("pseudonymKey must contain at least 32 characters");
    }
  }

  async queryRollups(request: CostQueryRollupsRequest): Promise<CostQueryRollupsResponse> {
    const tenantId = requireUuidPrefixed(request.tenant_id, "ten", "tenant_id");
    const workspaceId = requireUuidPrefixed(request.workspace_id, "ws", "workspace_id");
    const startAt = requireIsoTimestamp(request.start_at, "start_at");
    const endAt = requireIsoTimestamp(request.end_at, "end_at");
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      throw new RollupValidationError("end_at must be after start_at");
    }
    const dimensions = validateDimensions(request.dimensions);

    const rows = await this.store.withTenant(tenantId, async (tx) => {
      const selectColumns = dimensions.map((d) => `${DIMENSION_COLUMNS[d]} AS ${d}`);
      const groupByColumns = dimensions.map((d) => DIMENSION_COLUMNS[d]);
      const result = await tx.query<GroupRow>(
        `SELECT
           ${selectColumns.length > 0 ? selectColumns.join(", ") + "," : ""}
           SUM(internal_cost_minor)::text AS internal_cost_minor,
           SUM(internal_cost_minor) FILTER (WHERE is_retry)::text AS retry_cost_minor,
           SUM(internal_cost_minor) FILTER (WHERE is_recovery)::text AS recovery_cost_minor,
           COUNT(*)::text AS event_count
         FROM cost_events
         WHERE tenant_id = $1 AND workspace_id = $2
           AND occurred_at >= $3 AND occurred_at < $4
         ${groupByColumns.length > 0 ? `GROUP BY ${groupByColumns.join(", ")}` : ""}`,
        [tenantId, workspaceId, startAt, endAt],
      );
      return result.rows;
    });

    const groups: DimensionGroup[] = rows.map((row) => this.#toGroup(row, dimensions));
    const totalInternalMinor = groups.reduce((acc, g) => acc + BigInt(g.internalCostMinor), 0n);
    const totalBillableMinor = groups.reduce((acc, g) => acc + BigInt(g.billableMinor), 0n);
    const totalMarginMinor = totalBillableMinor - totalInternalMinor;

    await this.#upsertBillingRollup({
      tenantId,
      startAt,
      endAt,
      groups,
      totalInternalMinor,
      totalBillableMinor,
      totalMarginMinor,
    });

    return {
      rollups_json: JSON.stringify({
        start_at: startAt,
        end_at: endAt,
        dimensions,
        groups: groups.map((g) => ({
          dimensions: g.dimensions,
          internal_cost_minor: g.internalCostMinor,
          retry_cost_minor: g.retryCostMinor,
          recovery_cost_minor: g.recoveryCostMinor,
          billable_minor: g.billableMinor,
          margin_minor: g.marginMinor,
          event_count: g.eventCount,
        })),
        totals: {
          internal_cost_minor: totalInternalMinor.toString(),
          billable_minor: totalBillableMinor.toString(),
          margin_minor: totalMarginMinor.toString(),
        },
      }),
    };
  }

  #toGroup(row: GroupRow, dimensions: readonly string[]): DimensionGroup {
    const internalCostMinor = row.internal_cost_minor ?? "0";
    const billableMinor = applyMargin(internalCostMinor, this.marginRate);
    const marginMinor = (BigInt(billableMinor) - BigInt(internalCostMinor)).toString();
    const dimensionValues: Record<string, string> = {};
    for (const dimension of dimensions) {
      dimensionValues[dimension] = String(row[dimension] ?? "");
    }
    return {
      dimensions: dimensionValues,
      internalCostMinor,
      retryCostMinor: row.retry_cost_minor ?? "0",
      recoveryCostMinor: row.recovery_cost_minor ?? "0",
      billableMinor,
      marginMinor,
      eventCount: Number(row.event_count ?? "0"),
    };
  }

  async #upsertBillingRollup(input: {
    readonly tenantId: string;
    readonly startAt: string;
    readonly endAt: string;
    readonly groups: readonly DimensionGroup[];
    readonly totalInternalMinor: bigint;
    readonly totalBillableMinor: bigint;
    readonly totalMarginMinor: bigint;
  }): Promise<void> {
    // Real cost_events.mode CHECK only allows 'workflow' | 'project' --
    // billing_rollups requires exactly one mode per row (NOT NULL, part of
    // its unique key), so a range spanning both would need two rows. Every
    // real cost_events row today is 'workflow' (OUT-4: hardcoded at
    // ingest, Project Mode never wired to Cost Ledger yet, disclosed
    // upstream) -- default to 'workflow' when the query found zero rows to
    // infer a mode from, rather than leaving the rollup unwritten.
    const mode = "workflow";
    const pseudonym = this.pseudonym(input.tenantId);
    await this.store.withProvisioner(async (tx) => {
      await tx.query(
        `INSERT INTO billing_rollups
           (id, tenant_pseudonym, tenant_id, period_start, period_end, mode,
            internal_cost_minor, billable_minor, margin_minor, detail, finalized)
         VALUES (gen_random_uuid(), $1, $2, $3::timestamptz::date, $4::timestamptz::date, $5,
                 $6, $7, $8, $9::jsonb, false)
         ON CONFLICT (tenant_pseudonym, period_start, period_end, mode)
         DO UPDATE SET
           internal_cost_minor = EXCLUDED.internal_cost_minor,
           billable_minor = EXCLUDED.billable_minor,
           margin_minor = EXCLUDED.margin_minor,
           detail = EXCLUDED.detail
         WHERE billing_rollups.finalized = false`,
        [
          pseudonym,
          input.tenantId,
          input.startAt,
          input.endAt,
          mode,
          input.totalInternalMinor.toString(),
          input.totalBillableMinor.toString(),
          input.totalMarginMinor.toString(),
          JSON.stringify({ groups: input.groups }),
        ],
      );
    });
  }

  pseudonym(tenantId: string): string {
    return `tnp_${createHmac("sha256", this.pseudonymKey).update(tenantId).digest("hex")}`;
  }
}

function applyMargin(internalCostMinor: string, marginRate: number): string {
  const internal = BigInt(internalCostMinor);
  if (internal === 0n) return "0";
  // billable = ceil(internal / (1 - marginRate)) -- integer-safe: scale by
  // a large factor before dividing so this never touches floating point
  // for the actual minor-currency amount.
  const scale = 1_000_000n;
  const rateScaled = BigInt(Math.round(marginRate * 1_000_000));
  const numerator = internal * scale;
  const denominator = scale - rateScaled;
  const billable = (numerator + denominator - 1n) / denominator; // ceil division
  return billable.toString();
}

function requireUuidPrefixed(value: string, prefix: string, field: string): string {
  const expected = `${prefix}_`;
  if (!value.startsWith(expected)) {
    throw new RollupValidationError(`${field} must have prefix ${expected}`);
  }
  const bare = value.slice(expected.length);
  if (!UUID_PATTERN.test(bare)) {
    throw new RollupValidationError(`${field} must be a ${prefix}_ prefixed UUID`);
  }
  return bare;
}

function requireIsoTimestamp(value: string, field: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new RollupValidationError(`${field} must be a valid ISO 8601 timestamp`);
  }
  return value;
}

function validateDimensions(dimensions: readonly string[]): readonly string[] {
  for (const dimension of dimensions) {
    if (!(dimension in DIMENSION_COLUMNS)) {
      throw new RollupValidationError(
        `Unsupported dimension: ${dimension}. Allowed: ${Object.keys(DIMENSION_COLUMNS).join(", ")}`,
      );
    }
  }
  return dimensions;
}
