import type {
  DeployctlPromoteVersionRequest,
  DeployctlPromoteVersionResponse,
  DeployctlRollbackVersionRequest,
  DeployctlRollbackVersionResponse,
  DeployctlStartCanaryRequest,
  DeployctlStartCanaryResponse,
} from "@alterx/contracts";

const TENANT_ID_PATTERN =
  /^ten_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_ID_PATTERN =
  /^wf_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_VERSION_ID_PATTERN =
  /^wfv_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_WRITE_ATTEMPTS = 3;

type WorkflowVersionStatus =
  | "compiled"
  | "canary"
  | "promoted"
  | "rolled_back"
  | "retired";

type TransitionPurpose =
  | "start_canary"
  | "promote_target"
  | "retire_current"
  | "rollback_current"
  | "restore_target";

const VALID_TRANSITIONS: Readonly<
  Record<
    TransitionPurpose,
    Readonly<Partial<Record<WorkflowVersionStatus, readonly WorkflowVersionStatus[]>>>
  >
> = {
  // Operation-scoped transitions keep routine promotion separate from
  // rollback restoration: retired versions can return to promoted only as
  // an explicit rollback target, never through promoteVersion.
  start_canary: { compiled: ["canary"] },
  promote_target: { compiled: ["promoted"], canary: ["promoted"] },
  retire_current: { promoted: ["retired"] },
  rollback_current: { promoted: ["rolled_back"] },
  restore_target: { retired: ["promoted"] },
};

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

interface WorkflowRevisionRow extends Record<string, unknown> {
  readonly revision: string;
}

interface WorkflowVersionRow extends Record<string, unknown> {
  readonly id: string;
  readonly status: string;
}

interface PromotedAtRow extends Record<string, unknown> {
  readonly promoted_at: Date | string;
}

interface VersionSnapshot {
  readonly target: {
    readonly id: string;
    readonly status: WorkflowVersionStatus;
  };
  readonly currentPromoted?: {
    readonly id: string;
    readonly status: "promoted";
  };
  readonly currentCanary?: {
    readonly id: string;
    readonly status: "canary";
  };
}

export class DeploymentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentValidationError";
  }
}

export class DeploymentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentNotFoundError";
  }
}

export class DeploymentStateTransitionError extends Error {
  constructor(
    purpose: TransitionPurpose,
    from: WorkflowVersionStatus,
    to: WorkflowVersionStatus,
  ) {
    super(`invalid ${purpose} transition from ${from} to ${to}`);
    this.name = "DeploymentStateTransitionError";
  }
}

export class DeploymentConcurrencyError extends Error {
  constructor(workflowId: string, reason = "concurrent lifecycle writes did not settle") {
    super(`deployment update failed for workflow_id=${workflowId}: ${reason}`);
    this.name = "DeploymentConcurrencyError";
  }
}

class RetryDeploymentWrite extends Error {}

function bareTenantUuid(tenantId: string): string {
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new DeploymentValidationError(
      "tenant_id must be a ten_ prefixed UUIDv7",
    );
  }
  return tenantId.slice("ten_".length);
}

function requireWorkflowId(workflowId: string): void {
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new DeploymentValidationError(
      "workflow_id must be a wf_ prefixed UUIDv7",
    );
  }
}

function requireWorkflowVersionId(field: string, value: string): void {
  if (!WORKFLOW_VERSION_ID_PATTERN.test(value)) {
    throw new DeploymentValidationError(
      `${field} must be a wfv_ prefixed UUIDv7`,
    );
  }
}

function requireTrafficPercent(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new DeploymentValidationError(
      "traffic_percent must be an integer from 1 to 99",
    );
  }
}

function workflowVersionStatus(value: string): WorkflowVersionStatus {
  if (
    value === "compiled" ||
    value === "canary" ||
    value === "promoted" ||
    value === "rolled_back" ||
    value === "retired"
  ) {
    return value;
  }
  throw new Error(`database returned unknown workflow version status ${value}`);
}

function assertValidStatusTransition(
  purpose: TransitionPurpose,
  from: WorkflowVersionStatus,
  to: WorkflowVersionStatus,
): void {
  if (!VALID_TRANSITIONS[purpose][from]?.includes(to)) {
    throw new DeploymentStateTransitionError(purpose, from, to);
  }
}

function isoTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("database returned an invalid promoted_at timestamp");
  }
  return parsed.toISOString();
}

function isRetryableDatabaseError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === "40001" || code === "40P01";
}

async function readVersionSnapshot(
  tx: OrchestrationTransactionLike,
  tenantId: string,
  workflowId: string,
  targetVersionId: string,
): Promise<VersionSnapshot> {
  const result = await tx.query<WorkflowVersionRow>(
    `SELECT id, status
     FROM workflow_versions
     WHERE tenant_id = $1
       AND workflow_id = $2
       AND (id = $3 OR status IN ('promoted', 'canary'))
     ORDER BY id`,
    [tenantId, workflowId, targetVersionId],
  );
  const targetRow = result.rows.find((row) => row.id === targetVersionId);
  if (targetRow === undefined) {
    throw new DeploymentNotFoundError(
      `workflow_version_id "${targetVersionId}" was not found for workflow_id "${workflowId}"`,
    );
  }

  const promotedRows = result.rows.filter((row) => row.status === "promoted");
  if (promotedRows.length > 1) {
    throw new DeploymentConcurrencyError(
      workflowId,
      "more than one promoted version already exists",
    );
  }
  const promotedRow = promotedRows[0];
  const canaryRows = result.rows.filter((row) => row.status === "canary");
  if (canaryRows.length > 1) {
    throw new DeploymentConcurrencyError(
      workflowId,
      "more than one canary version already exists",
    );
  }
  const canaryRow = canaryRows[0];

  return {
    target: {
      id: targetRow.id,
      status: workflowVersionStatus(targetRow.status),
    },
    ...(promotedRow === undefined
      ? {}
      : {
          currentPromoted: {
            id: promotedRow.id,
            status: "promoted" as const,
          },
        }),
    ...(canaryRow === undefined
      ? {}
      : {
          currentCanary: {
            id: canaryRow.id,
            status: "canary" as const,
          },
        }),
  };
}

async function claimWorkflowRevision(
  tx: OrchestrationTransactionLike,
  tenantId: string,
  workflowId: string,
  revision: string,
): Promise<void> {
  // xmin is an exact transaction revision. Using the timestamptz value as
  // the predicate would lose sub-millisecond precision when pg converts it
  // to a JavaScript Date and would turn uncontended writes into false races.
  const result = await tx.query(
    `UPDATE workflows
     SET updated_at = GREATEST(updated_at + interval '1 microsecond', clock_timestamp())
     WHERE tenant_id = $1 AND id = $2 AND xmin::text = $3`,
    [tenantId, workflowId, revision],
  );
  if (result.rowCount !== 1) {
    throw new RetryDeploymentWrite();
  }
}

function requireSingleWrite(rowCount: number): void {
  if (rowCount !== 1) {
    throw new RetryDeploymentWrite();
  }
}

export class DeploymentControllerService {
  constructor(private readonly store: OrchestrationTenantStore) {}

  async promoteVersion(
    request: DeployctlPromoteVersionRequest,
  ): Promise<DeployctlPromoteVersionResponse> {
    requireWorkflowId(request.workflow_id);
    requireWorkflowVersionId(
      "workflow_version_id",
      request.workflow_version_id,
    );
    const tenantId = bareTenantUuid(request.tenant_id);

    return this.withOptimisticRetry(tenantId, request.workflow_id, async (tx, revision) => {
      const snapshot = await readVersionSnapshot(
        tx,
        tenantId,
        request.workflow_id,
        request.workflow_version_id,
      );
      assertValidStatusTransition(
        "promote_target",
        snapshot.target.status,
        "promoted",
      );
      if (snapshot.currentPromoted !== undefined) {
        assertValidStatusTransition(
          "retire_current",
          snapshot.currentPromoted.status,
          "retired",
        );
      }

      await claimWorkflowRevision(tx, tenantId, request.workflow_id, revision);

      if (snapshot.currentPromoted !== undefined) {
        const retired = await tx.query(
          `UPDATE workflow_versions
           SET status = 'retired', traffic_percent = NULL
           WHERE tenant_id = $1 AND workflow_id = $2 AND id = $3 AND status = 'promoted'`,
          [tenantId, request.workflow_id, snapshot.currentPromoted.id],
        );
        requireSingleWrite(retired.rowCount);
      }

      const promoted = await tx.query<PromotedAtRow>(
        `UPDATE workflow_versions
         SET status = 'promoted', traffic_percent = NULL
         WHERE tenant_id = $1 AND workflow_id = $2 AND id = $3 AND status = $4
         RETURNING clock_timestamp() AS promoted_at`,
        [
          tenantId,
          request.workflow_id,
          request.workflow_version_id,
          snapshot.target.status,
        ],
      );
      requireSingleWrite(promoted.rowCount);

      return {
        status: "promoted",
        promoted_at: isoTimestamp(promoted.rows[0]!.promoted_at),
      };
    });
  }

  async startCanary(
    request: DeployctlStartCanaryRequest,
  ): Promise<DeployctlStartCanaryResponse> {
    requireWorkflowId(request.workflow_id);
    requireWorkflowVersionId(
      "workflow_version_id",
      request.workflow_version_id,
    );
    requireTrafficPercent(request.traffic_percent);
    const tenantId = bareTenantUuid(request.tenant_id);

    return this.withOptimisticRetry(tenantId, request.workflow_id, async (tx, revision) => {
      const snapshot = await readVersionSnapshot(
        tx,
        tenantId,
        request.workflow_id,
        request.workflow_version_id,
      );
      if (
        snapshot.currentCanary !== undefined &&
        snapshot.currentCanary.id !== snapshot.target.id
      ) {
        throw new DeploymentStateTransitionError(
          "start_canary",
          snapshot.currentCanary.status,
          "canary",
        );
      }
      assertValidStatusTransition(
        "start_canary",
        snapshot.target.status,
        "canary",
      );

      await claimWorkflowRevision(tx, tenantId, request.workflow_id, revision);
      const canary = await tx.query(
        `UPDATE workflow_versions
         SET status = 'canary', traffic_percent = $4
         WHERE tenant_id = $1 AND workflow_id = $2 AND id = $3 AND status = 'compiled'`,
        [
          tenantId,
          request.workflow_id,
          request.workflow_version_id,
          request.traffic_percent,
        ],
      );
      requireSingleWrite(canary.rowCount);

      return {
        status: "canary",
        traffic_percent: request.traffic_percent,
      };
    });
  }

  async rollbackVersion(
    request: DeployctlRollbackVersionRequest,
  ): Promise<DeployctlRollbackVersionResponse> {
    requireWorkflowId(request.workflow_id);
    requireWorkflowVersionId("target_version_id", request.target_version_id);
    const tenantId = bareTenantUuid(request.tenant_id);

    return this.withOptimisticRetry(tenantId, request.workflow_id, async (tx, revision) => {
      const snapshot = await readVersionSnapshot(
        tx,
        tenantId,
        request.workflow_id,
        request.target_version_id,
      );
      if (snapshot.currentPromoted === undefined) {
        throw new DeploymentStateTransitionError(
          "rollback_current",
          snapshot.target.status,
          "rolled_back",
        );
      }
      assertValidStatusTransition(
        "rollback_current",
        snapshot.currentPromoted.status,
        "rolled_back",
      );
      assertValidStatusTransition(
        "restore_target",
        snapshot.target.status,
        "promoted",
      );

      await claimWorkflowRevision(tx, tenantId, request.workflow_id, revision);
      const rolledBack = await tx.query(
        `UPDATE workflow_versions
         SET status = 'rolled_back', traffic_percent = NULL
         WHERE tenant_id = $1 AND workflow_id = $2 AND id = $3 AND status = 'promoted'`,
        [tenantId, request.workflow_id, snapshot.currentPromoted.id],
      );
      requireSingleWrite(rolledBack.rowCount);

      const restored = await tx.query(
        `UPDATE workflow_versions
         SET status = 'promoted', traffic_percent = NULL
         WHERE tenant_id = $1 AND workflow_id = $2 AND id = $3 AND status = 'retired'`,
        [tenantId, request.workflow_id, request.target_version_id],
      );
      requireSingleWrite(restored.rowCount);

      return {
        status: "rolled_back",
        active_version_id: request.target_version_id,
      };
    });
  }

  private async withOptimisticRetry<T>(
    tenantId: string,
    workflowId: string,
    operation: (
      tx: OrchestrationTransactionLike,
      revision: string,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      try {
        return await this.store.withTenant(tenantId, async (tx) => {
          const workflow = await tx.query<WorkflowRevisionRow>(
            `SELECT xmin::text AS revision
             FROM workflows
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, workflowId],
          );
          const row = workflow.rows[0];
          if (row === undefined) {
            throw new DeploymentNotFoundError(
              `workflow_id "${workflowId}" was not found`,
            );
          }
          return operation(tx, row.revision);
        });
      } catch (error: unknown) {
        if (error instanceof RetryDeploymentWrite || isRetryableDatabaseError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new DeploymentConcurrencyError(
      workflowId,
      `${MAX_WRITE_ATTEMPTS} optimistic write attempts were exhausted`,
    );
  }
}
