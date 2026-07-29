import { RunIdSchema, TenantIdSchema } from "@alterx/contracts";

import type { OrchestrationTenantStore } from "../runs/node-execution-ledger.service";

export interface VerificationResultRecord {
  readonly gateType: string;
  readonly verdict: string;
  readonly score: string | number | null;
  readonly threshold: string | number | null;
  readonly details: unknown;
}

export interface VerificationGateReader {
  findForSourceNode(request: { readonly tenantId: string; readonly runId: string; readonly sourceNodeKey: string }): Promise<readonly VerificationResultRecord[]>;
}

/** Uses the latest upstream attempt and the existing tenant RLS boundary. */
export class PostgresVerificationGateReader implements VerificationGateReader {
  constructor(private readonly store: OrchestrationTenantStore) {}

  async findForSourceNode(request: { readonly tenantId: string; readonly runId: string; readonly sourceNodeKey: string }): Promise<readonly VerificationResultRecord[]> {
    const tenant = TenantIdSchema.safeParse(request.tenantId);
    if (!tenant.success || !RunIdSchema.safeParse(request.runId).success || request.sourceNodeKey.trim().length === 0) return [];
    const tenantId = tenant.data.slice("ten_".length);
    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{ readonly gate_type: string; readonly verdict: string; readonly score: string | number | null; readonly threshold: string | number | null; readonly details: unknown }>(
        `WITH latest_source AS (
           SELECT id FROM node_executions
           WHERE tenant_id = $1 AND run_id = $2 AND dag_node_id = $3
           ORDER BY attempt DESC, started_at DESC LIMIT 1
         )
         SELECT gate_type, verdict, score, threshold, details
         FROM verification_results
         WHERE tenant_id = $1 AND run_id = $2
           AND node_execution_id = (SELECT id FROM latest_source)
         ORDER BY created_at DESC, id DESC`,
        [tenantId, request.runId, request.sourceNodeKey],
      );
      return result.rows.map((row) => ({ gateType: row.gate_type, verdict: row.verdict, score: row.score, threshold: row.threshold, details: row.details }));
    });
  }
}
