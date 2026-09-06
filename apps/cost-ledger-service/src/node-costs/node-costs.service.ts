import { Inject, Injectable } from "@nestjs/common";

import {
  COST_STORE_PROVIDER,
  type CostStoreProvider,
} from "../database/cost-store.token";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface NodeCostRow extends Record<string, unknown> {
  readonly node_execution_id: string;
  readonly internal_cost_minor: string;
  readonly event_count: string;
}

export interface NodeCost {
  readonly nodeExecutionId: string;
  readonly internalCostMinor: string;
  readonly eventCount: number;
}

export class NodeCostValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeCostValidationError";
  }
}

@Injectable()
export class NodeCostsService {
  constructor(
    @Inject(COST_STORE_PROVIDER)
    private readonly store: CostStoreProvider,
  ) {}

  async getForRun(input: {
    readonly tenantId: unknown;
    readonly workspaceId: unknown;
    readonly runId: unknown;
  }): Promise<readonly NodeCost[]> {
    const tenantId = requirePrefixedUuid(input.tenantId, "ten", "tenantId");
    const workspaceId = requirePrefixedUuid(
      input.workspaceId,
      "ws",
      "workspaceId",
    );
    const runId = requirePrefixedUuid(input.runId, "run", "runId");

    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<NodeCostRow>(
        `SELECT node_execution_id::text,
                SUM(internal_cost_minor)::text AS internal_cost_minor,
                COUNT(*)::text AS event_count
           FROM cost_events
          WHERE tenant_id = $1
            AND workspace_id = $2
            AND run_id = $3
            AND node_execution_id IS NOT NULL
          GROUP BY node_execution_id
          ORDER BY node_execution_id`,
        [tenantId, workspaceId, runId],
      );

      return result.rows.map((row) => ({
        nodeExecutionId: `node_${row.node_execution_id}`,
        internalCostMinor: row.internal_cost_minor,
        eventCount: Number(row.event_count),
      }));
    });
  }
}

// Query parameters are absent, not empty, when a caller omits them, so this
// takes unknown rather than string: the declared type does not survive the
// wire. Dereferencing an absent value here threw a TypeError before the
// validator could raise its own error, turning a missing tenantId into a 500
// instead of the 400 this function exists to produce.
function requirePrefixedUuid(value: unknown, prefix: string, field: string): string {
  const expected = `${prefix}_`;
  if (typeof value !== "string" || value.length === 0) {
    throw new NodeCostValidationError(`${field} is required`);
  }
  if (!value.startsWith(expected)) {
    throw new NodeCostValidationError(`${field} must have prefix ${expected}`);
  }
  const bare = value.slice(expected.length);
  if (!UUID_PATTERN.test(bare)) {
    throw new NodeCostValidationError(`${field} must be a ${prefix}_ prefixed UUID`);
  }
  return bare;
}
