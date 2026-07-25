import { randomUUID } from "node:crypto";

import { computeNextCronFireTime, validateCronExpression } from "./cron-validator";
import { defaultDlqPolicy, validateDlqPolicy, type DlqPolicy } from "./dlq-policy";

export class TriggerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriggerValidationError";
  }
}

export class TriggerNotFoundError extends Error {
  constructor(triggerId: string) {
    super(`Trigger ${triggerId} was not found`);
    this.name = "TriggerNotFoundError";
  }
}

export class TriggerStateTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Trigger cannot transition from "${from}" to "${to}"`);
    this.name = "TriggerStateTransitionError";
  }
}

export type TriggerType = "webhook" | "cron" | "manual";
export type TriggerStatus = "draft" | "enabled" | "disabled" | "archived";
export type TriggerVersionStatus = "active" | "superseded" | "disabled";

export interface TriggerVersionConfig {
  readonly cronExpression?: string;
  readonly dlqPolicy: DlqPolicy;
  readonly [key: string]: unknown;
}

export interface Trigger {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly name: string;
  readonly type: TriggerType;
  readonly status: TriggerStatus;
  readonly provider: string | null;
}

export interface TriggerVersion {
  readonly id: string;
  readonly tenantId: string;
  readonly triggerId: string;
  readonly version: number;
  readonly workflowVersionId: string | null;
  readonly config: TriggerVersionConfig;
  readonly status: TriggerVersionStatus;
  readonly nextFireAt: string | null;
}

export interface RegisterTriggerRequest {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly name: string;
  readonly type: TriggerType;
  readonly provider?: string;
  readonly workflowVersionId?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface RegisterTriggerResult {
  readonly trigger: Trigger;
  readonly triggerVersion: TriggerVersion;
}

export interface CreateTriggerVersionRequest {
  readonly tenantId: string;
  readonly triggerId: string;
  readonly workflowVersionId?: string;
  readonly config?: Readonly<Record<string, unknown>>;
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

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireNonEmpty(field: string, value: string | undefined): void {
  if (value === undefined || value.trim().length === 0) {
    throw new TriggerValidationError(`${field} is required`);
  }
}

function requireValidWorkflowVersionId(workflowVersionId: string | undefined): void {
  if (workflowVersionId === undefined) {
    return;
  }
  // workflow_versions doesn't exist yet (Planning phase's Deployment
  // Controller, PLAN-9/PLAN-11, not built) -- trigger_versions.workflow_version_id
  // has no FK constraint to anything real yet. This validates UUID *shape*
  // only. Real binding-to-an-actual-compiled-DAG-version enforcement must be
  // added once that table exists; this is a disclosed, deliberate gap, not
  // an oversight.
  if (!UUID_V7_PATTERN.test(workflowVersionId)) {
    throw new TriggerValidationError(
      "workflowVersionId must be a UUIDv7-shaped string",
    );
  }
}

function buildVersionConfig(
  type: TriggerType,
  rawConfig: Readonly<Record<string, unknown>> | undefined,
): TriggerVersionConfig {
  const config = rawConfig ?? {};
  const dlqPolicy = validateDlqPolicy(config.dlqPolicy ?? {});

  if (type === "cron") {
    const cronExpression = config.cronExpression;
    if (typeof cronExpression !== "string" || cronExpression.trim().length === 0) {
      throw new TriggerValidationError(
        "cron triggers require a non-empty config.cronExpression",
      );
    }
    validateCronExpression(cronExpression);
    return { ...config, cronExpression, dlqPolicy };
  }

  return { ...config, dlqPolicy };
}

function computeNextFireAt(config: TriggerVersionConfig): string | null {
  if (config.cronExpression === undefined) {
    return null;
  }
  return computeNextCronFireTime(config.cronExpression).toISOString();
}

export class TriggerRegistryService {
  constructor(
    private readonly store: OrchestrationTenantStore,
    private readonly mintId: () => string = () => randomUUID(),
  ) {}

  async registerTrigger(
    request: RegisterTriggerRequest,
  ): Promise<RegisterTriggerResult> {
    requireNonEmpty("tenantId", request.tenantId);
    requireNonEmpty("workspaceId", request.workspaceId);
    requireNonEmpty("workflowId", request.workflowId);
    requireNonEmpty("name", request.name);
    if (!["webhook", "cron", "manual"].includes(request.type)) {
      throw new TriggerValidationError(
        `type must be one of webhook, cron, manual`,
      );
    }
    requireValidWorkflowVersionId(request.workflowVersionId);
    const config = buildVersionConfig(request.type, request.config);
    const nextFireAt = computeNextFireAt(config);

    return this.store.withTenant(request.tenantId, async (tx) => {
      const triggerId = `trg_${this.mintId()}`;
      const triggerVersionId = `trv_${this.mintId()}`;

      await tx.query(
        `INSERT INTO triggers (id, tenant_id, workspace_id, workflow_id, name, type, status, provider)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)`,
        [
          triggerId,
          request.tenantId,
          request.workspaceId,
          request.workflowId,
          request.name,
          request.type,
          request.provider ?? null,
        ],
      );
      await tx.query(
        `INSERT INTO trigger_versions (id, tenant_id, trigger_id, version, workflow_version_id, config, status, activated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', now())`,
        [
          triggerVersionId,
          request.tenantId,
          triggerId,
          1,
          request.workflowVersionId ?? null,
          JSON.stringify(config),
        ],
      );

      return {
        trigger: {
          id: triggerId,
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          workflowId: request.workflowId,
          name: request.name,
          type: request.type,
          status: "draft",
          provider: request.provider ?? null,
        },
        triggerVersion: {
          id: triggerVersionId,
          tenantId: request.tenantId,
          triggerId,
          version: 1,
          workflowVersionId: request.workflowVersionId ?? null,
          config,
          status: "active",
          nextFireAt,
        },
      };
    });
  }

  async createTriggerVersion(
    request: CreateTriggerVersionRequest,
  ): Promise<TriggerVersion> {
    requireNonEmpty("tenantId", request.tenantId);
    requireNonEmpty("triggerId", request.triggerId);
    requireValidWorkflowVersionId(request.workflowVersionId);

    return this.store.withTenant(request.tenantId, async (tx) => {
      const triggerResult = await tx.query<{ type: TriggerType }>(
        `SELECT type FROM triggers WHERE tenant_id = $1 AND id = $2`,
        [request.tenantId, request.triggerId],
      );
      const triggerRow = triggerResult.rows[0];
      if (triggerRow === undefined) {
        throw new TriggerNotFoundError(request.triggerId);
      }
      const config = buildVersionConfig(triggerRow.type, request.config);
      const nextFireAt = computeNextFireAt(config);

      const currentVersionResult = await tx.query<{ version: number }>(
        `SELECT version FROM trigger_versions
         WHERE tenant_id = $1 AND trigger_id = $2
         ORDER BY version DESC LIMIT 1`,
        [request.tenantId, request.triggerId],
      );
      const currentVersion = currentVersionResult.rows[0]?.version ?? 0;
      const nextVersion = currentVersion + 1;

      await tx.query(
        `UPDATE trigger_versions SET status = 'superseded'
         WHERE tenant_id = $1 AND trigger_id = $2 AND status = 'active'`,
        [request.tenantId, request.triggerId],
      );

      const triggerVersionId = `trv_${this.mintId()}`;
      await tx.query(
        `INSERT INTO trigger_versions (id, tenant_id, trigger_id, version, workflow_version_id, config, status, activated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', now())`,
        [
          triggerVersionId,
          request.tenantId,
          request.triggerId,
          nextVersion,
          request.workflowVersionId ?? null,
          JSON.stringify(config),
        ],
      );

      return {
        id: triggerVersionId,
        tenantId: request.tenantId,
        triggerId: request.triggerId,
        version: nextVersion,
        workflowVersionId: request.workflowVersionId ?? null,
        config,
        status: "active" as const,
        nextFireAt,
      };
    });
  }

  async setTriggerStatus(
    tenantId: string,
    triggerId: string,
    targetStatus: TriggerStatus,
  ): Promise<Trigger> {
    requireNonEmpty("tenantId", tenantId);
    requireNonEmpty("triggerId", triggerId);

    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{
        id: string;
        workspace_id: string;
        workflow_id: string;
        name: string;
        type: TriggerType;
        status: TriggerStatus;
        provider: string | null;
      }>(
        `SELECT id, workspace_id, workflow_id, name, type, status, provider
         FROM triggers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, triggerId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new TriggerNotFoundError(triggerId);
      }
      assertValidStatusTransition(row.status, targetStatus);

      await tx.query(
        `UPDATE triggers SET status = $1, updated_at = now()
         WHERE tenant_id = $2 AND id = $3`,
        [targetStatus, tenantId, triggerId],
      );

      return {
        id: row.id,
        tenantId,
        workspaceId: row.workspace_id,
        workflowId: row.workflow_id,
        name: row.name,
        type: row.type,
        status: targetStatus,
        provider: row.provider,
      };
    });
  }

  async getTrigger(tenantId: string, triggerId: string): Promise<Trigger> {
    requireNonEmpty("tenantId", tenantId);
    requireNonEmpty("triggerId", triggerId);

    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{
        id: string;
        workspace_id: string;
        workflow_id: string;
        name: string;
        type: TriggerType;
        status: TriggerStatus;
        provider: string | null;
      }>(
        `SELECT id, workspace_id, workflow_id, name, type, status, provider
         FROM triggers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, triggerId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new TriggerNotFoundError(triggerId);
      }
      return {
        id: row.id,
        tenantId,
        workspaceId: row.workspace_id,
        workflowId: row.workflow_id,
        name: row.name,
        type: row.type,
        status: row.status,
        provider: row.provider,
      };
    });
  }

  async listTriggers(tenantId: string, workflowId?: string): Promise<readonly Trigger[]> {
    requireNonEmpty("tenantId", tenantId);

    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{
        id: string;
        workspace_id: string;
        workflow_id: string;
        name: string;
        type: TriggerType;
        status: TriggerStatus;
        provider: string | null;
      }>(
        workflowId === undefined
          ? `SELECT id, workspace_id, workflow_id, name, type, status, provider
             FROM triggers WHERE tenant_id = $1 ORDER BY created_at DESC`
          : `SELECT id, workspace_id, workflow_id, name, type, status, provider
             FROM triggers WHERE tenant_id = $1 AND workflow_id = $2 ORDER BY created_at DESC`,
        workflowId === undefined ? [tenantId] : [tenantId, workflowId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        tenantId,
        workspaceId: row.workspace_id,
        workflowId: row.workflow_id,
        name: row.name,
        type: row.type,
        status: row.status,
        provider: row.provider,
      }));
    });
  }
}

const VALID_TRANSITIONS: Record<TriggerStatus, readonly TriggerStatus[]> = {
  draft: ["enabled", "archived"],
  enabled: ["disabled", "archived"],
  disabled: ["enabled", "archived"],
  archived: [],
};

function assertValidStatusTransition(
  from: TriggerStatus,
  to: TriggerStatus,
): void {
  if (from === to) {
    return;
  }
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new TriggerStateTransitionError(from, to);
  }
}

export { defaultDlqPolicy };
