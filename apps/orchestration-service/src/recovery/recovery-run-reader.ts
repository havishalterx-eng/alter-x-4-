import { CompiledDagSchema } from "@alterx/contracts";

import type { RecoveryRunReader } from "./recovery-dispatch.service";
import type { RecoveryTenantStore } from "./recovery-policy.service";

export class RecoveryRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} was not found`);
    this.name = "RecoveryRunNotFoundError";
  }
}

export class RecoveryRunCompiledDagUnavailableError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} has no valid compiled DAG to replan from`);
    this.name = "RecoveryRunCompiledDagUnavailableError";
  }
}

/** Real read/write target for the "replan" and "terminate" strategies. */
export class PostgresRecoveryRunReader implements RecoveryRunReader {
  constructor(private readonly store: RecoveryTenantStore) {}

  async loadCompiledDagJson(
    tenantId: string,
    runId: string,
  ): Promise<{
    readonly compiledDagJson: string;
    readonly dagSchemaVersion: string;
    readonly workflowId: string;
    readonly workspaceId: string;
  }> {
    return this.store.withTenant(tenantId, async (tx) => {
      const runResult = await tx.query<{
        readonly workflow_id: string;
        readonly workflow_version_id: string | null;
        readonly workspace_id: string;
      }>(
        "SELECT workflow_id, workflow_version_id, workspace_id FROM runs WHERE tenant_id = $1 AND id = $2",
        [tenantId, runId],
      );
      const runRow = runResult.rows[0];
      if (runRow === undefined) throw new RecoveryRunNotFoundError(runId);
      const workflowVersionId = runRow.workflow_version_id;
      if (workflowVersionId === null) {
        throw new RecoveryRunCompiledDagUnavailableError(runId);
      }
      const versionResult = await tx.query<{ readonly compiled_dag: unknown }>(
        "SELECT compiled_dag FROM workflow_versions WHERE tenant_id = $1 AND id = $2",
        [tenantId, workflowVersionId],
      );
      const compiledDagRaw = versionResult.rows[0]?.compiled_dag;
      const parsed = CompiledDagSchema.safeParse(compiledDagRaw);
      if (!parsed.success) {
        throw new RecoveryRunCompiledDagUnavailableError(runId);
      }
      return {
        compiledDagJson: JSON.stringify(parsed.data),
        dagSchemaVersion: parsed.data.schema_version,
        workflowId: runRow.workflow_id,
        workspaceId: runRow.workspace_id,
      };
    });
  }

  async writeTerminalFailed(tenantId: string, runId: string): Promise<void> {
    await this.store.withTenant(tenantId, async (tx) => {
      // Reuses the existing 'failed' terminal state (runs_status_check has
      // no separate "terminated" value) -- HEAL-8 reads this as a real
      // terminal run when it wires run_outcomes.
      await tx.query(
        `UPDATE runs SET status = 'failed', ended_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'running', 'paused')`,
        [tenantId, runId],
      );
    });
  }
}
