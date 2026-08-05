import { TenantIdSchema } from "@alterx/contracts";
import { randomUUID } from "node:crypto";

export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`Workflow ${workflowId} was not found`);
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export type WorkflowStatus = "draft" | "active" | "archived";

export interface Workflow {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly status: WorkflowStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateWorkflowRequest {
  readonly tenantId: string;
  readonly workflowId: string;
  readonly name?: string;
  readonly status?: WorkflowStatus;
}

export interface CreateWorkflowRequest {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly name: string;
}

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

type WorkflowRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly status: WorkflowStatus;
  readonly created_at: string;
  readonly updated_at: string;
};

function fromRow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireNonEmpty(field: string, value: string | undefined): void {
  if (value === undefined || value.trim().length === 0) {
    throw new WorkflowValidationError(`${field} is required`);
  }
}

/**
 * `workflows.tenant_id` is a real `uuid`-typed column
 * (0000_create_workflows.sql) -- the real, signed-JWT-derived
 * ActorContext.tenant_id SessionGatewayGuard populates is always
 * `ten_`-prefixed (TenantIdSchema), so it must be stripped before use in
 * raw SQL or `store.withTenant()`. Same real pattern as
 * NodeExecutionLedgerService's own `bareTenantUuid()`
 * (runs/node-execution-ledger.service.ts) -- duplicated locally per this
 * repo's own convention (each module keeps its own copy, not a shared
 * helper).
 */
function bareTenantUuid(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new WorkflowValidationError("tenantId must be a ten_ prefixed UUIDv7");
  }
  return parsed.data.slice("ten_".length);
}

function bareWorkspaceUuid(workspaceId: string): string {
  if (!/^ws_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workspaceId)) {
    throw new WorkflowValidationError("workspaceId must be a ws_ prefixed UUIDv7");
  }
  return workspaceId.slice("ws_".length);
}

function newWorkflowId(): `wf_${string}` {
  const uuid = randomUUID();
  return `wf_${uuid.slice(0, 14)}7${uuid.slice(15)}`;
}

/**
 * Real read/update surface over the real, RLS-scoped `workflows` table
 * (0000_create_workflows.sql -- ENABLE+FORCE RLS, `workflows_tenant_id_id_
 * unique` constraint, `workflows_tenant_context_isolation` policy keyed off
 * `app.current_tenant_id`). This table has existed since Planning (PLAN-9)
 * but had zero real reader/writer anywhere in the codebase until now --
 * platform-api's WorkflowController/WorkflowService (GET/PATCH /api/v1/
 * workflows/:id) called an orchestration-service route that never existed.
 *
 * Deliberately minimal: no etag/If-Match concurrency control, no canvas
 * body, no versions/validate/compile/simulate/activate/pause/resume --
 * those are real, larger production-feature scope (platform-api's own
 * WorkflowController already has real etag handling on its side; wiring
 * that through end-to-end is a disclosed, separate follow-up). This closes
 * exactly what the workflow_get/workflow_update tenant-isolation cases and
 * a genuine "does this route exist" gap need: real tenant-scoped read and
 * a real name/status update, both real RLS-enforced, both real 404s for
 * any row outside the caller's own tenant.
 */
export class WorkflowReadService {
  constructor(private readonly store: OrchestrationTenantStore) {}

  async createWorkflow(request: CreateWorkflowRequest): Promise<Workflow> {
    requireNonEmpty("tenantId", request.tenantId);
    requireNonEmpty("workspaceId", request.workspaceId);
    requireNonEmpty("name", request.name);
    const bareTenant = bareTenantUuid(request.tenantId);
    const bareWorkspace = bareWorkspaceUuid(request.workspaceId);
    const workflowId = newWorkflowId();
    return this.store.withTenant(bareTenant, async (tx) => {
      const result = await tx.query<WorkflowRow>(
        `INSERT INTO workflows (id, tenant_id, workspace_id, name, status)
         VALUES ($1, $2, $3, $4, 'draft')
         RETURNING id, tenant_id, workspace_id, name, status, created_at, updated_at`,
        [workflowId, bareTenant, bareWorkspace, request.name.trim()],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new WorkflowValidationError("workflow insert returned no row");
      }
      return fromRow(row);
    });
  }

  async getWorkflow(tenantId: string, workflowId: string): Promise<Workflow> {
    requireNonEmpty("tenantId", tenantId);
    requireNonEmpty("workflowId", workflowId);
    const bareTenant = bareTenantUuid(tenantId);
    return this.store.withTenant(bareTenant, async (tx) => {
      const result = await tx.query<WorkflowRow>(
        `SELECT id, tenant_id, workspace_id, name, status, created_at, updated_at
         FROM workflows WHERE tenant_id = $1 AND id = $2`,
        [bareTenant, workflowId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new WorkflowNotFoundError(workflowId);
      }
      return fromRow(row);
    });
  }

  async updateWorkflow(request: UpdateWorkflowRequest): Promise<Workflow> {
    requireNonEmpty("tenantId", request.tenantId);
    requireNonEmpty("workflowId", request.workflowId);
    if (request.name !== undefined) {
      requireNonEmpty("name", request.name);
    }
    if (request.status !== undefined && !["draft", "active", "archived"].includes(request.status)) {
      throw new WorkflowValidationError("status must be one of draft, active, archived");
    }
    const bareTenant = bareTenantUuid(request.tenantId);
    return this.store.withTenant(bareTenant, async (tx) => {
      const result = await tx.query<WorkflowRow>(
        `UPDATE workflows
         SET name = COALESCE($3, name), status = COALESCE($4, status), updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, tenant_id, workspace_id, name, status, created_at, updated_at`,
        [bareTenant, request.workflowId, request.name ?? null, request.status ?? null],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new WorkflowNotFoundError(request.workflowId);
      }
      return fromRow(row);
    });
  }
}
