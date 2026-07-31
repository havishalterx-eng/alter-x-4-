import { RunIdSchema, TenantIdSchema } from "@alterx/contracts";

import {
  RunNotFoundError,
  RunValidationError,
  type OrchestrationTenantStore,
} from "./run-launcher.service";

/**
 * Minimal, dedicated lookup for OUT-4's Cost Ledger ingestion: resolves a
 * run's workspace_id without joining across cost_db's boundary (doc 04
 * SS1). Deliberately its own query rather than reusing RunLauncherService's
 * RUN_SELECT_COLUMNS -- that select list is shared by createRun/listRuns/
 * getRun and doesn't carry workspace_id; adding it there would widen an
 * unrelated response shape for every caller.
 */
export class RunWorkspaceLookupService {
  constructor(private readonly store: OrchestrationTenantStore) {}

  async getWorkspaceId(tenantIdInput: string, runIdInput: string): Promise<string> {
    const tenantId = bareTenantUuid(tenantIdInput);
    const runId = validatedRunId(runIdInput);
    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{ readonly workspace_id: string }>(
        "SELECT workspace_id FROM runs WHERE tenant_id = $1 AND id = $2",
        [tenantId, runId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new RunNotFoundError(runId);
      return row.workspace_id;
    });
  }
}

function bareTenantUuid(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new RunValidationError(`Invalid tenant_id: ${tenantId}`);
  }
  return parsed.data.slice("ten_".length);
}

function validatedRunId(runId: string): string {
  const parsed = RunIdSchema.safeParse(runId);
  if (!parsed.success) {
    throw new RunValidationError(`Invalid run_id: ${runId}`);
  }
  return parsed.data;
}
