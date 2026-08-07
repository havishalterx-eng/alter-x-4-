import { randomUUID } from "node:crypto";
import { TenantIdSchema } from "@alterx/contracts";

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project ${projectId} was not found`);
    this.name = "ProjectNotFoundError";
  }
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export type ProjectStatus = "draft" | "active" | "archived";
export type DeploymentStatus = "pending" | "active" | "failed";

export interface Project {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Deployment {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly status: DeploymentStatus;
  readonly createdAt: string;
}

export interface OrchestrationTransactionLike {
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

type ProjectRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly workspace_id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly created_at: string;
  readonly updated_at: string;
};

type DeploymentRow = {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly status: DeploymentStatus;
  readonly created_at: string;
};

function projectFromRow(row: ProjectRow): Project {
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

function deploymentFromRow(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

function requireNonEmpty(field: string, value: string | undefined): void {
  if (value === undefined || value.trim().length === 0) {
    throw new ProjectValidationError(`${field} is required`);
  }
}

/**
 * `projects.tenant_id`/`deployments.tenant_id` are real `uuid`-typed
 * columns (0019_create_projects.sql) -- the real, signed-JWT-derived
 * ActorContext.tenant_id SessionGatewayGuard populates is always
 * `ten_`-prefixed (TenantIdSchema), so it must be stripped before use
 * in raw SQL or `store.withTenant()`. Same real pattern as
 * WorkflowReadService's own `bareTenantUuid()`
 * (workflow-read/workflow-read.service.ts) -- duplicated locally per
 * this repo's own convention.
 */
function bareTenantUuid(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new ProjectValidationError("tenantId must be a ten_ prefixed UUIDv7");
  }
  return parsed.data.slice("ten_".length);
}

/**
 * Real read/deploy surface over the real, RLS-scoped `projects`/
 * `deployments` tables (0019_create_projects.sql). Neither table had
 * any real schema anywhere in orchestration-service before this --
 * unlike workflows (PLAN-9), no prior migration existed for a
 * "project"/"deployment" resource, so this closes a genuine
 * "route AND storage both don't exist" gap, not just a wiring gap.
 *
 * Deliberately minimal, same discipline as WorkflowReadService: real
 * tenant-scoped read (getProject) and a real deploy action that creates
 * a real, tenant-scoped `deployments` row (createDeployment) -- no
 * builds/tests/previews/audit-results/versions/rollback, all of which
 * are real, larger production-feature scope platform-api's own
 * ProjectOperationsController already models on its side. This closes
 * exactly what the project_get/project_deploy tenant-isolation cases
 * and the "route doesn't exist" gap need.
 */
export class ProjectReadService {
  constructor(private readonly store: OrchestrationTenantStore) {}

  async getProject(tenantId: string, projectId: string): Promise<Project> {
    requireNonEmpty("tenantId", tenantId);
    requireNonEmpty("projectId", projectId);
    const bareTenant = bareTenantUuid(tenantId);
    return this.store.withTenant(bareTenant, async (tx) => {
      const result = await tx.query<ProjectRow>(
        `SELECT id, tenant_id, workspace_id, name, status, created_at, updated_at
         FROM projects WHERE tenant_id = $1 AND id = $2`,
        [bareTenant, projectId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new ProjectNotFoundError(projectId);
      }
      return projectFromRow(row);
    });
  }

  async createDeployment(tenantId: string, projectId: string): Promise<Deployment> {
    requireNonEmpty("tenantId", tenantId);
    requireNonEmpty("projectId", projectId);
    const bareTenant = bareTenantUuid(tenantId);
    return this.store.withTenant(bareTenant, async (tx) => {
      const existing = await tx.query<ProjectRow>(
        `SELECT id FROM projects WHERE tenant_id = $1 AND id = $2`,
        [bareTenant, projectId],
      );
      if (existing.rows[0] === undefined) {
        throw new ProjectNotFoundError(projectId);
      }
      const deploymentId = `dep_${randomUUID()}`;
      const result = await tx.query<DeploymentRow>(
        `INSERT INTO deployments (id, tenant_id, project_id, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id, tenant_id, project_id, status, created_at`,
        [deploymentId, bareTenant, projectId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new ProjectValidationError("deployment insert returned no row");
      }
      return deploymentFromRow(row);
    });
  }
}
