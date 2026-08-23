import {
  DeploymentAdminActionRequestSchema,
  type DeploymentAdminActionRequest,
  type DeploymentAdminActionResult,
} from "@alterx/contracts";
import type { OrchestrationTenantStore } from "../workflow-lifecycle/workflow-lifecycle.service";

type DeploymentStatus = "pending" | "active" | "failed" | "rolled_back" | "suspended";

interface DeploymentRow extends Record<string, unknown> {
  readonly id: string;
  readonly project_id: string;
  readonly status: DeploymentStatus;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface OrchestrationTransactionLike {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rowCount: number; readonly rows: readonly TRow[] }>;
}

export class DeploymentAdminNotFoundError extends Error {}
export class DeploymentAdminConflictError extends Error {}

export class DeploymentAdminService {
  constructor(private readonly store: OrchestrationTenantStore) {}

  apply(input: DeploymentAdminActionRequest): Promise<DeploymentAdminActionResult> {
    const request = DeploymentAdminActionRequestSchema.parse(input);
    return this.store.withTenant(request.tenant_id, async (tx) => {
      const selected = await tx.query<DeploymentRow>(
        `SELECT id, project_id, status, created_at, updated_at
         FROM deployments
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [request.tenant_id, request.deployment_id],
      );
      const target = selected.rows[0];
      if (!target) {
        throw new DeploymentAdminNotFoundError(`Deployment ${request.deployment_id} was not found`);
      }

      if (request.action === "suspend") {
        this.requireStatus(target, "active", request.action);
        const updated = await this.updateStatus(tx, request.tenant_id, target.id, "active", "suspended");
        return result(request, updated, null, "suspended");
      }

      if (request.action === "resume") {
        this.requireStatus(target, "suspended", request.action);
        const active = await tx.query<{ readonly id: string }>(
          `SELECT id FROM deployments
           WHERE tenant_id = $1 AND project_id = $2 AND status = 'active' AND id <> $3
           FOR UPDATE`,
          [request.tenant_id, target.project_id, target.id],
        );
        if (active.rows[0]) {
          throw new DeploymentAdminConflictError(
            `Project ${target.project_id} already has active deployment ${active.rows[0].id}`,
          );
        }
        const updated = await this.updateStatus(tx, request.tenant_id, target.id, "suspended", "active");
        return result(request, updated, updated.id, "active");
      }

      this.requireStatus(target, "active", request.action);
      const previous = await tx.query<DeploymentRow>(
        `SELECT id, project_id, status, created_at, updated_at
         FROM deployments
         WHERE tenant_id = $1 AND project_id = $2 AND status = 'rolled_back'
           AND created_at < $3
         ORDER BY created_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [request.tenant_id, target.project_id, target.created_at],
      );
      const replacement = previous.rows[0];
      if (!replacement) {
        throw new DeploymentAdminConflictError(
          `Deployment ${target.id} has no previous deployment to restore`,
        );
      }
      await this.updateStatus(tx, request.tenant_id, target.id, "active", "rolled_back");
      const restored = await this.updateStatus(
        tx,
        request.tenant_id,
        replacement.id,
        "rolled_back",
        "active",
      );
      return result(request, target, restored.id, "rolled_back", restored.updated_at);
    });
  }

  private requireStatus(
    deployment: DeploymentRow,
    expected: DeploymentStatus,
    action: DeploymentAdminActionRequest["action"],
  ): void {
    if (deployment.status !== expected) {
      throw new DeploymentAdminConflictError(
        `Cannot ${action} deployment ${deployment.id} from status ${deployment.status}`,
      );
    }
  }

  private async updateStatus(
    tx: OrchestrationTransactionLike,
    tenantId: string,
    deploymentId: string,
    from: DeploymentStatus,
    to: DeploymentStatus,
  ): Promise<DeploymentRow> {
    const updated = await tx.query<DeploymentRow>(
      `UPDATE deployments
       SET status = $4, updated_at = clock_timestamp()
       WHERE tenant_id = $1 AND id = $2 AND status = $3
       RETURNING id, project_id, status, created_at, updated_at`,
      [tenantId, deploymentId, from, to],
    );
    const row = updated.rows[0];
    if (!row) {
      throw new DeploymentAdminConflictError(
        `Deployment ${deploymentId} changed during ${from} to ${to} transition`,
      );
    }
    return row;
  }
}

function result(
  request: DeploymentAdminActionRequest,
  deployment: DeploymentRow,
  activeDeploymentId: string | null,
  status: "active" | "rolled_back" | "suspended",
  updatedAt: Date | string = deployment.updated_at,
): DeploymentAdminActionResult {
  return {
    tenant_id: request.tenant_id,
    deployment_id: request.deployment_id,
    project_id: deployment.project_id,
    action: request.action,
    status,
    active_deployment_id: activeDeploymentId,
    updated_at: new Date(updatedAt).toISOString(),
  };
}
