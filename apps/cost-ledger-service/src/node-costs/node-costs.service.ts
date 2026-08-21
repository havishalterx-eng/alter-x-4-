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
    readonly tenantId: string;
    readonly workspaceId: string;
    readonly runId: string;
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

function requirePrefixedUuid(value: string, prefix: string, field: string): string {
  const expected = `${prefix}_`;
  if (!value.startsWith(expected)) {
    throw new NodeCostValidationError(`${field} must have prefix ${expected}`);
  }
  const bare = value.slice(expected.length);
  if (!UUID_PATTERN.test(bare)) {
    throw new NodeCostValidationError(`${field} must be a ${prefix}_ prefixed UUID`);
  }
  return bare;
}
