import {
  RunIdSchema,
  TenantIdSchema,
  type ProvisioningProvisionRequest,
} from "@alterx/contracts";
import type { ProvisioningClientHandler } from "@alterx/adapters";

export interface ProjectRunProvisioningTransaction {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

export interface ProjectRunProvisioningStore {
  withTenant<T>(
    tenantId: string,
    operation: (tx: ProjectRunProvisioningTransaction) => Promise<T>,
  ): Promise<T>;
}

export type ProjectRunProvisioningInput = Pick<
  ProvisioningProvisionRequest,
  "cycle_id" | "template_id" | "environment_refs" | "scaffold"
>;

export class ProjectRunProvisioningError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "ProjectRunProvisioningError";
  }
}

interface ProvisioningRunRow extends Record<string, unknown> {
  readonly project_id: string | null;
  readonly provisioning_cycle_id: string | null;
  readonly provisioning_session_id: string | null;
  readonly provisioning_closed_at: string | null;
}

function bareTenantUuid(tenantIdInput: string): string {
  const parsed = TenantIdSchema.safeParse(tenantIdInput);
  if (!parsed.success) {
    throw new ProjectRunProvisioningError(
      "tenantId must be a ten_ prefixed UUIDv7",
    );
  }
  return parsed.data.slice("ten_".length);
}

function requireRunId(runId: string): void {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new ProjectRunProvisioningError("runId must be a run_ prefixed UUIDv7");
  }
}

/**
 * Persists the Provisioning service's real session identifier on a project
 * run. The row, rather than process memory or Temporal workflow state, is
 * the handoff boundary for the following materializer step and worker
 * restarts.
 */
export class ProjectRunProvisioningService {
  constructor(
    private readonly store: ProjectRunProvisioningStore,
    private readonly provisioning: ProvisioningClientHandler,
  ) {}

  async provisionForRun(
    tenantIdInput: string,
    runId: string,
    projectId: string,
    input: ProjectRunProvisioningInput,
  ): Promise<string> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireRunId(runId);

    const existing = await this.loadRun(tenantId, runId);
    if (
      existing === undefined ||
      existing.project_id !== projectId ||
      existing.provisioning_cycle_id !== input.cycle_id
    ) {
      throw new ProjectRunProvisioningError(
        `project run ${runId} is not provisionable for this project cycle`,
      );
    }
    if (
      existing.provisioning_session_id !== null &&
      existing.provisioning_session_id.trim().length > 0
    ) {
      return existing.provisioning_session_id;
    }

    const response = await this.provisioning.provision({
      tenant_id: tenantIdInput,
      run_id: runId,
      project_id: projectId,
      cycle_id: input.cycle_id,
      template_id: input.template_id,
      environment_refs: input.environment_refs,
      scaffold: input.scaffold,
    });
    const sessionId = response.session_id.trim();
    if (sessionId.length === 0) {
      throw new ProjectRunProvisioningError(
        "Provisioning Service returned an empty session_id",
      );
    }

    await this.store.withTenant(tenantId, async (tx) => {
      const persisted = await tx.query(
        `UPDATE runs
         SET provisioning_session_id = $4
         WHERE tenant_id = $1 AND id = $2 AND project_id = $3
           AND provisioning_cycle_id = $5
           AND provisioning_session_id IS NULL`,
        [tenantId, runId, projectId, sessionId, input.cycle_id],
      );
      if (persisted.rowCount !== 1) {
        return;
      }
    });
    const persisted = await this.loadRun(tenantId, runId);
    if (
      persisted === undefined ||
      persisted.project_id !== projectId ||
      persisted.provisioning_cycle_id !== input.cycle_id ||
      persisted.provisioning_session_id === null ||
      persisted.provisioning_session_id.trim().length === 0
    ) {
      throw new ProjectRunProvisioningError(
        `project run ${runId} could not persist its provisioning session`,
      );
    }
    return persisted.provisioning_session_id;
  }

  /**
   * Node execution resolves this durable handoff when a project DAG's
   * compiled node config has no session yet. Non-project runs intentionally
   * return undefined rather than inventing a sandbox session.
   */
  async getSessionForRun(
    tenantIdInput: string,
    runId: string,
  ): Promise<string | undefined> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireRunId(runId);
    const row = await this.loadRun(tenantId, runId);
    if (
      row === undefined ||
      row.project_id === null ||
      row.provisioning_session_id === null ||
      row.provisioning_session_id.trim().length === 0
    ) {
      return undefined;
    }
    return row.provisioning_session_id;
  }

  /**
   * Closing is idempotent: the provider is called before the durable marker
   * is written, so a process failure between those steps merely retries the
   * provider's own idempotent CloseCycle operation.
   */
  async closeForTerminalRun(tenantIdInput: string, runId: string): Promise<void> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireRunId(runId);

    const row = await this.loadRun(tenantId, runId);
    if (
      row === undefined ||
      row.project_id === null ||
      row.provisioning_cycle_id === null ||
      row.provisioning_closed_at !== null
    ) {
      return;
    }

    await this.provisioning.closeCycle({
      tenant_id: tenantIdInput,
      run_id: runId,
      project_id: row.project_id,
      cycle_id: row.provisioning_cycle_id,
    });

    await this.store.withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE runs SET provisioning_closed_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2
           AND provisioning_closed_at IS NULL`,
        [tenantId, runId],
      );
    });
  }

  private async loadRun(
    tenantId: string,
    runId: string,
  ): Promise<ProvisioningRunRow | undefined> {
    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<ProvisioningRunRow>(
        `SELECT project_id, provisioning_cycle_id, provisioning_session_id,
                provisioning_closed_at::text
         FROM runs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, runId],
      );
      return result.rows[0];
    });
  }
}
