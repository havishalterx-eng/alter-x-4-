import { randomUUID } from "node:crypto";

import {
  CompiledDagSchema,
  RunIdSchema,
  TenantIdSchema,
  WorkflowIdSchema,
  WorkflowVersionIdSchema,
  type CompiledDag,
} from "@alterx/contracts";
import type {
  DurableExecutionProvider,
  DurableWorkflowHandle,
} from "@alterx/shared-clients";
import type { RunOutcomeService } from "./run-outcome.service";
import {
  ProjectRunProvisioningError,
  type ProjectRunProvisioningInput,
  type ProjectRunProvisioningService,
} from "./project-run-provisioning.service";

const EXECUTOR_WORKFLOW_TYPE = "executorWorkflow";
const RUNNABLE_VERSION_STATUSES = new Set(["compiled", "canary", "promoted"]);

interface OrchestrationTransactionLike {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

export interface OrchestrationTenantStore {
  withTenant<T>(
    tenantId: string,
    operation: (tx: OrchestrationTransactionLike) => Promise<T>,
  ): Promise<T>;
}

export class RunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunValidationError";
  }
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} was not found`);
    this.name = "RunNotFoundError";
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} was not found`);
    this.name = "WorkflowNotFoundError";
  }
}

export class RunStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunStateConflictError";
  }
}

export class RunStartFailedError extends Error {
  constructor(runId: string, cause: unknown) {
    super(`Run ${runId} failed to start its durable workflow`, { cause });
    this.name = "RunStartFailedError";
  }
}

export class ProjectRunProvisioningFailedError extends Error {
  constructor(runId: string, cause: unknown) {
    super(`Run ${runId} failed to provision its sandbox session`, { cause });
    this.name = "ProjectRunProvisioningFailedError";
  }
}

export class ProjectRunProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} was not found`);
    this.name = "ProjectRunProjectNotFoundError";
  }
}

export interface RunRow extends Record<string, unknown> {
  readonly id: string;
  readonly workflow_id: string | null;
  readonly project_id?: string | null;
  readonly workflow_version_id: string | null;
  readonly provisioning_session_id?: string | null;
  readonly provisioning_cycle_id?: string | null;
  readonly provisioning_template_id?: string | null;
  readonly provisioning_closed_at?: string | null;
  readonly parent_kind: string;
  readonly status: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly created_at: string;
}

export interface CreateProjectRunInput extends ProjectRunProvisioningInput {
  readonly projectId: string;
  readonly compiledDag: CompiledDag;
}

export interface RunPage {
  readonly data: readonly RunRow[];
  readonly page: {
    readonly next_cursor: string | null;
    readonly has_more: boolean;
    readonly limit: number;
  };
}

function bareTenantUuid(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new RunValidationError("tenantId must be a ten_ prefixed UUIDv7");
  }
  return parsed.data.slice("ten_".length);
}

function requireRunId(runId: string): void {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new RunValidationError("runId must be a run_ prefixed UUIDv7");
  }
}

function requireWorkflowId(workflowId: string): void {
  if (!WorkflowIdSchema.safeParse(workflowId).success) {
    throw new RunValidationError("workflowId must be a wf_ prefixed UUIDv7");
  }
}

function requireWorkflowVersionId(workflowVersionId: string): void {
  if (!WorkflowVersionIdSchema.safeParse(workflowVersionId).success) {
    throw new RunValidationError(
      "workflowVersionId must be a wfv_ prefixed UUIDv7",
    );
  }
}

function requireProjectId(projectId: string): void {
  if (!/^prj_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new RunValidationError("projectId must be a prj_ prefixed UUIDv7");
  }
}

function requireProvisioningInput(input: ProjectRunProvisioningInput): void {
  if (!/^[A-Za-z0-9_-]+$/.test(input.cycle_id)) {
    throw new RunValidationError("cycle_id must be an identifier");
  }
  if (input.template_id.trim().length === 0) {
    throw new RunValidationError("template_id is required");
  }
}

function newRunId(): string {
  const id = randomUUID();
  return `run_${id.slice(0, 14)}7${id.slice(15)}`;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new RunValidationError("limit must be an integer from 1 to 200");
  }
  return limit;
}

const RUN_SELECT_COLUMNS = `id, workflow_id, project_id, workflow_version_id,
       provisioning_session_id, provisioning_cycle_id, provisioning_template_id,
       provisioning_closed_at::text, parent_kind, status, started_at::text,
       ended_at::text, created_at::text`;

/**
 * Owns the run's actual lifecycle: creating the durable `runs` row,
 * starting the Executor's Temporal workflow, and the cancel/retry-node
 * actions. EXEC-14 -- closes the gap NodeexecService's docstring flagged
 * ("full run lifecycle... remains EXEC-14 scope").
 */
export class RunLauncherService {
  constructor(
    private readonly store: OrchestrationTenantStore,
    private readonly durable: DurableExecutionProvider,
    private readonly runOutcomes?: RunOutcomeService,
    private readonly projectProvisioning?: ProjectRunProvisioningService,
  ) {}

  async createRun(
    tenantIdInput: string,
    workflowId: string,
    workflowVersionId?: string,
  ): Promise<RunRow> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireWorkflowId(workflowId);
    if (workflowVersionId !== undefined) {
      requireWorkflowVersionId(workflowVersionId);
    }

    const created = await this.store.withTenant(tenantId, async (tx) => {
      const workflow = await tx.query<{ readonly id: string }>(
        "SELECT id FROM workflows WHERE tenant_id = $1 AND id = $2",
        [tenantId, workflowId],
      );
      if (workflow.rowCount === 0) {
        throw new WorkflowNotFoundError(workflowId);
      }

      const version = await this.resolveVersion(tx, tenantId, workflowId, workflowVersionId);
      const runId = newRunId();

      const inserted = await tx.query<RunRow>(
        `INSERT INTO runs (id, tenant_id, workspace_id, parent_kind, workflow_id, workflow_version_id, status)
         SELECT $3, $1, workspace_id, 'workflow', $2, $4, 'pending'
         FROM workflows WHERE tenant_id = $1 AND id = $2
         RETURNING ${RUN_SELECT_COLUMNS}`,
        [tenantId, workflowId, runId, version.id],
      );
      return { row: inserted.rows[0]!, compiledDag: version.compiledDag };
    });

    return this.startAndTransition(tenantId, created.row, created.compiledDag);
  }

  /**
   * Project builds intentionally have their own creation path: a project is
   * not a workflow and has no workflow version to resolve. The caller owns
   * the build cycle/template choice; this service durably binds the real
   * Provisioning session to the new run before the Executor can start.
   */
  async createProjectRun(
    tenantIdInput: string,
    input: CreateProjectRunInput,
  ): Promise<RunRow> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireProjectId(input.projectId);
    requireProvisioningInput(input);
    const parsedDag = CompiledDagSchema.safeParse(input.compiledDag);
    if (!parsedDag.success) {
      throw new RunValidationError(
        `project build compiled_dag failed schema validation: ${parsedDag.error.message}`,
      );
    }
    if (this.projectProvisioning === undefined) {
      throw new ProjectRunProvisioningError(
        "Project run provisioning is not configured",
      );
    }

    const row = await this.store.withTenant(tenantId, async (tx) => {
      const project = await tx.query<{ readonly workspace_id: string }>(
        "SELECT workspace_id FROM projects WHERE tenant_id = $1 AND id = $2",
        [tenantId, input.projectId],
      );
      if (project.rowCount === 0) {
        throw new ProjectRunProjectNotFoundError(input.projectId);
      }
      const runId = newRunId();
      const inserted = await tx.query<RunRow>(
        `INSERT INTO runs
           (id, tenant_id, workspace_id, parent_kind, project_id,
            provisioning_cycle_id, provisioning_template_id, status)
         VALUES ($1, $2, $3, 'project', $4, $5, $6, 'pending')
         RETURNING ${RUN_SELECT_COLUMNS}`,
        [
          runId,
          tenantId,
          project.rows[0]!.workspace_id,
          input.projectId,
          input.cycle_id,
          input.template_id,
        ],
      );
      return inserted.rows[0]!;
    });

    try {
      await this.projectProvisioning.provisionForRun(
        tenantIdInput,
        row.id,
        input.projectId,
        input,
      );
    } catch (error: unknown) {
      await this.markProjectRunProvisioningFailed(tenantId, tenantIdInput, row.id);
      throw new ProjectRunProvisioningFailedError(row.id, error);
    }

    const provisioned = await this.getRun(tenantIdInput, row.id);
    return this.startAndTransition(tenantId, provisioned, parsedDag.data);
  }

  async listRuns(
    tenantIdInput: string,
    query: {
      readonly workflowId?: string;
      readonly mode?: "workflow" | "project";
      readonly status?: string;
      readonly cursor?: string;
      readonly limit?: number;
    } = {},
  ): Promise<RunPage> {
    const tenantId = bareTenantUuid(tenantIdInput);
    const limit = normalizeLimit(query.limit);
    if (query.workflowId !== undefined) requireWorkflowId(query.workflowId);
    if (query.mode !== undefined && query.mode !== "workflow" && query.mode !== "project") {
      throw new RunValidationError("mode must be workflow or project");
    }
    if (query.cursor !== undefined) requireRunId(query.cursor);

    return this.store.withTenant(tenantId, async (tx) => {
      const conditions: string[] = ["tenant_id = $1"];
      const values: unknown[] = [tenantId];

      if (query.workflowId !== undefined) {
        values.push(query.workflowId);
        conditions.push(`workflow_id = $${values.length}`);
      }
      if (query.mode !== undefined) {
        values.push(query.mode);
        conditions.push(`parent_kind = $${values.length}`);
      }
      if (query.status !== undefined) {
        values.push(query.status);
        conditions.push(`status = $${values.length}`);
      }
      if (query.cursor !== undefined) {
        const cursorRow = await tx.query<{ readonly created_at: string }>(
          "SELECT created_at::text FROM runs WHERE tenant_id = $1 AND id = $2",
          [tenantId, query.cursor],
        );
        const createdAt = cursorRow.rows[0]?.created_at;
        if (createdAt === undefined) {
          throw new RunValidationError("cursor does not belong to this tenant");
        }
        values.push(createdAt, query.cursor);
        conditions.push(
          `(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length})`,
        );
      }

      values.push(limit + 1);
      const result = await tx.query<RunRow>(
        `SELECT ${RUN_SELECT_COLUMNS}
         FROM runs WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length}`,
        values,
      );
      const rows = [...result.rows];
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      return {
        data,
        page: {
          next_cursor: hasMore ? data.at(-1)?.id ?? null : null,
          has_more: hasMore,
          limit,
        },
      };
    });
  }

  async getRun(tenantIdInput: string, runId: string): Promise<RunRow> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireRunId(runId);
    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<RunRow>(
        `SELECT ${RUN_SELECT_COLUMNS} FROM runs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, runId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new RunNotFoundError(runId);
      return row;
    });
  }

  async cancelRun(tenantIdInput: string, runId: string): Promise<RunRow> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireRunId(runId);

    const current = await this.getRun(tenantIdInput, runId);
    if (["pending", "running", "paused"].includes(current.status)) {
      try {
        await this.durable.terminateWorkflow({
          workflowId: runId,
          reason: "Cancelled via API",
        });
      } catch {
        // Best-effort: the workflow may have already closed (raced with
        // finalizeRun) between the read above and this call. The
        // optimistic UPDATE below is the real source of truth.
      }
    }

    const row = await this.store.withTenant(tenantId, async (tx) => {
      const updated = await tx.query<RunRow>(
        `UPDATE runs SET status = 'cancelled', ended_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'running', 'paused')
         RETURNING ${RUN_SELECT_COLUMNS}`,
        [tenantId, runId],
      );
      if (updated.rowCount === 1) return updated.rows[0]!;

      // Already terminal (finished/failed/cancelled concurrently) --
      // cancelling an already-finished run is a no-op, not an error.
      const result = await tx.query<RunRow>(
        `SELECT ${RUN_SELECT_COLUMNS} FROM runs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, runId],
      );
      const existing = result.rows[0];
      if (existing === undefined) throw new RunNotFoundError(runId);
      return existing;
    });

    // HEAL-8: durable.terminateWorkflow (above) hard-kills the Temporal
    // workflow execution when it succeeds -- the Executor's own
    // try/finally (NodeexecService.finalizeRun) then never runs, so this
    // is the only real write site for a 'cancelled' verdict. Idempotent
    // (ON CONFLICT DO NOTHING) against the race the comment above already
    // documents; also a safe no-op if the run was already terminal for a
    // different real reason (completed/failed already wrote their own
    // verdict first).
    if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
      try {
        await this.runOutcomes?.recordOutcome(tenantIdInput, runId, row.status);
      } catch (error: unknown) {
        console.error("run_outcomes write failed -- VACR/VADR metrics gap", {
          run_id: runId,
          status: row.status,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.projectProvisioning?.closeForTerminalRun(tenantIdInput, runId);
    return row;
  }

  async retryNode(
    tenantIdInput: string,
    runId: string,
    nodeKey: string,
  ): Promise<RunRow> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireRunId(runId);
    if (nodeKey.trim().length === 0) {
      throw new RunValidationError("node_key is required");
    }

    const { row, compiledDag } = await this.store.withTenant(tenantId, async (tx) => {
      const runResult = await tx.query<
        RunRow & { readonly workflow_version_id: string | null }
      >(
        `SELECT ${RUN_SELECT_COLUMNS} FROM runs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, runId],
      );
      const runRow = runResult.rows[0];
      if (runRow === undefined) throw new RunNotFoundError(runId);
      if (runRow.status !== "failed") {
        throw new RunStateConflictError(
          `retry-node requires run status "failed", got "${runRow.status}"`,
        );
      }
      if (runRow.workflow_version_id === null) {
        throw new RunStateConflictError(
          "run has no recorded workflow_version_id -- cannot resolve its compiled DAG",
        );
      }

      const versionResult = await tx.query<{ readonly compiled_dag: unknown }>(
        "SELECT compiled_dag FROM workflow_versions WHERE tenant_id = $1 AND id = $2",
        [tenantId, runRow.workflow_version_id],
      );
      const compiledDagRaw = versionResult.rows[0]?.compiled_dag;
      if (compiledDagRaw === undefined) {
        throw new RunStateConflictError(
          `workflow_version ${runRow.workflow_version_id} referenced by this run no longer exists`,
        );
      }
      const parsedDag = CompiledDagSchema.safeParse(compiledDagRaw);
      if (!parsedDag.success) {
        throw new RunStateConflictError(
          "run's recorded compiled DAG failed schema validation",
        );
      }
      const node = parsedDag.data.nodes.find((candidate) => candidate.key === nodeKey);
      if (node === undefined) {
        throw new RunValidationError(
          `node_key "${nodeKey}" does not exist in this run's compiled DAG`,
        );
      }

      const updated = await tx.query<RunRow>(
        `UPDATE runs
         SET status = 'running', ended_at = NULL,
             started_at = COALESCE(started_at, clock_timestamp())
         WHERE tenant_id = $1 AND id = $2 AND status = 'failed'
         RETURNING ${RUN_SELECT_COLUMNS}`,
        [tenantId, runId],
      );
      if (updated.rowCount !== 1) {
        throw new RunStateConflictError(
          `run ${runId} was retried concurrently by another request`,
        );
      }

      const narrowedDag: CompiledDag = {
        schema_version: parsedDag.data.schema_version,
        entry_node_keys: [nodeKey],
        nodes: [node],
        edges: [],
        waves: [{ key: "retry", order: 0, node_keys: [nodeKey], depends_on: [] }],
      };
      return { row: updated.rows[0]!, compiledDag: narrowedDag };
    });

    return this.startAndTransition(tenantId, row, compiledDag, { alreadyRunning: true });
  }

  private async resolveVersion(
    tx: OrchestrationTransactionLike,
    tenantId: string,
    workflowId: string,
    workflowVersionId: string | undefined,
  ): Promise<{ readonly id: string; readonly compiledDag: CompiledDag }> {
    if (workflowVersionId !== undefined) {
      const result = await tx.query<{ readonly id: string; readonly status: string; readonly compiled_dag: unknown }>(
        "SELECT id, status, compiled_dag FROM workflow_versions WHERE tenant_id = $1 AND workflow_id = $2 AND id = $3",
        [tenantId, workflowId, workflowVersionId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new RunValidationError(
          `workflow_version_id "${workflowVersionId}" was not found for this workflow`,
        );
      }
      if (!RUNNABLE_VERSION_STATUSES.has(row.status)) {
        throw new RunValidationError(
          `workflow_version_id "${workflowVersionId}" has status "${row.status}" and cannot be run`,
        );
      }
      return { id: row.id, compiledDag: parseCompiledDag(row.compiled_dag) };
    }

    const promoted = await tx.query<{ readonly id: string; readonly compiled_dag: unknown }>(
      "SELECT id, compiled_dag FROM workflow_versions WHERE tenant_id = $1 AND workflow_id = $2 AND status = 'promoted'",
      [tenantId, workflowId],
    );
    const row = promoted.rows[0];
    if (row === undefined) {
      throw new RunValidationError(
        "workflow has no promoted version -- pass an explicit workflow_version_id",
      );
    }
    return { id: row.id, compiledDag: parseCompiledDag(row.compiled_dag) };
  }

  private async startAndTransition(
    tenantId: string,
    row: RunRow,
    compiledDag: CompiledDag,
    options: { readonly alreadyRunning?: boolean } = {},
  ): Promise<RunRow> {
    const tenantIdWithPrefix = `ten_${tenantId}`;
    let handle: DurableWorkflowHandle;
    try {
      handle = await this.durable.startWorkflow({
        workflowId: row.id,
        workflowType: EXECUTOR_WORKFLOW_TYPE,
        input: {
          tenantId: tenantIdWithPrefix,
          runId: row.id,
          compiledDagJson: JSON.stringify(compiledDag),
        },
      });
    } catch (error: unknown) {
      await this.store.withTenant(tenantId, async (tx) => {
        await tx.query(
          `UPDATE runs SET status = 'failed', ended_at = clock_timestamp()
           WHERE tenant_id = $1 AND id = $2 AND status IN ('pending', 'running')`,
          [tenantId, row.id],
        );
      });
      // HEAL-8: this run's Temporal workflow never started, so the
      // Executor's own try/finally (NodeexecService.finalizeRun) will
      // never run for it either -- the only real write site for this
      // run's verdict.
      try {
        await this.runOutcomes?.recordOutcome(tenantIdWithPrefix, row.id, "failed");
      } catch (outcomeError: unknown) {
        console.error("run_outcomes write failed -- VACR/VADR metrics gap", {
          run_id: row.id,
          status: "failed",
          error: outcomeError instanceof Error ? outcomeError.message : String(outcomeError),
        });
      }
      await this.projectProvisioning?.closeForTerminalRun(tenantIdWithPrefix, row.id);
      throw new RunStartFailedError(row.id, error);
    }
    void handle;

    if (options.alreadyRunning === true) {
      return row;
    }

    return this.store.withTenant(tenantId, async (tx) => {
      const updated = await tx.query<RunRow>(
        `UPDATE runs SET status = 'running', started_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND status = 'pending'
         RETURNING ${RUN_SELECT_COLUMNS}`,
        [tenantId, row.id],
      );
      return updated.rows[0] ?? row;
    });
  }

  private async markProjectRunProvisioningFailed(
    tenantId: string,
    tenantIdInput: string,
    runId: string,
  ): Promise<void> {
    await this.store.withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE runs SET status = 'failed', ended_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND status = 'pending'`,
        [tenantId, runId],
      );
    });
    try {
      await this.runOutcomes?.recordOutcome(tenantIdInput, runId, "failed");
    } catch (error: unknown) {
      console.error("run_outcomes write failed -- VACR/VADR metrics gap", {
        run_id: runId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await this.projectProvisioning?.closeForTerminalRun(tenantIdInput, runId);
  }
}

function parseCompiledDag(raw: unknown): CompiledDag {
  const parsed = CompiledDagSchema.safeParse(raw);
  if (!parsed.success) {
    throw new RunValidationError(
      `workflow_version's compiled_dag failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
