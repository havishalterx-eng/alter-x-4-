import {
  NodeExecutionIdSchema,
  NodeTypeSchema,
  RunIdSchema,
  TenantIdSchema,
  type ModelAlias,
} from "@alterx/contracts";

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

export type NodeExecutionStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "recovered";

export interface NodeExecutionStart {
  readonly tenantId: string;
  readonly runId: string;
  readonly nodeExecutionId: string;
  readonly dagNodeId: string;
  readonly nodeType: string;
  readonly modelAlias?: ModelAlias;
}

export interface NodeExecutionRecord extends Record<string, unknown> {
  readonly id: string;
  readonly run_id: string;
  readonly dag_node_id: string;
  readonly node_type: string;
  readonly attempt: number;
  readonly model_alias: ModelAlias | null;
  readonly model_resolved: string | null;
  readonly status: NodeExecutionStatus;
  readonly input_ref: string | null;
  readonly output_ref: string | null;
  readonly error: Record<string, unknown> | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

export interface NodeExecutionPage {
  readonly data: readonly NodeExecutionRecord[];
  readonly page: {
    readonly next_cursor: string | null;
    readonly has_more: boolean;
    readonly limit: number;
  };
}

export class NodeExecutionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeExecutionValidationError";
  }
}

export class NodeExecutionRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} was not found`);
    this.name = "NodeExecutionRunNotFoundError";
  }
}

export class NodeExecutionStateConflictError extends Error {
  constructor(nodeExecutionId: string) {
    super(`Node execution ${nodeExecutionId} cannot transition from its current state`);
    this.name = "NodeExecutionStateConflictError";
  }
}

interface RunRow extends Record<string, unknown> {
  readonly id: string;
}

interface NodeExecutionStateRow extends Record<string, unknown> {
  readonly status: NodeExecutionStatus;
}

function bareTenantUuid(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new NodeExecutionValidationError(
      "tenantId must be a ten_ prefixed UUIDv7",
    );
  }
  return parsed.data.slice("ten_".length);
}

function requireRunId(runId: string): void {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new NodeExecutionValidationError("runId must be a run_ prefixed UUIDv7");
  }
}

function requireNodeExecutionId(nodeExecutionId: string): void {
  if (!NodeExecutionIdSchema.safeParse(nodeExecutionId).success) {
    throw new NodeExecutionValidationError(
      "nodeExecutionId must be a node_ prefixed UUIDv7",
    );
  }
}

function requireNodeKey(nodeKey: string): void {
  if (nodeKey.trim().length === 0) {
    throw new NodeExecutionValidationError("dagNodeId is required");
  }
}

function requireNodeType(nodeType: string): void {
  if (!NodeTypeSchema.safeParse(nodeType).success) {
    throw new NodeExecutionValidationError("nodeType must be a supported NodeType");
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new NodeExecutionValidationError("limit must be an integer from 1 to 200");
  }
  return limit;
}

function requireCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (!NodeExecutionIdSchema.safeParse(cursor).success) {
    throw new NodeExecutionValidationError("cursor must be a node_ prefixed UUIDv7");
  }
  return cursor;
}

export class NodeExecutionLedgerService {
  constructor(private readonly store: OrchestrationTenantStore) {}

  async recordStarted(request: NodeExecutionStart): Promise<void> {
    const tenantId = bareTenantUuid(request.tenantId);
    requireRunId(request.runId);
    requireNodeExecutionId(request.nodeExecutionId);
    requireNodeKey(request.dagNodeId);
    requireNodeType(request.nodeType);

    const started = await this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<{ readonly id: string }>(
        `INSERT INTO node_executions
           (id, tenant_id, run_id, dag_node_id, node_type, model_alias, status)
         SELECT $3, $1, $2, $4, $5, $6, 'running'
         FROM runs
         WHERE tenant_id = $1 AND id = $2
         ON CONFLICT (id) DO UPDATE
           SET attempt = node_executions.attempt + 1,
               status = 'running',
               error = NULL,
               ended_at = NULL,
               started_at = clock_timestamp()
         WHERE node_executions.tenant_id = EXCLUDED.tenant_id
           AND node_executions.run_id = EXCLUDED.run_id
           AND node_executions.dag_node_id = EXCLUDED.dag_node_id
           AND node_executions.node_type = EXCLUDED.node_type
           AND node_executions.status = 'failed'
         RETURNING id`,
        [
          tenantId,
          request.runId,
          request.nodeExecutionId,
          request.dagNodeId,
          request.nodeType,
          request.modelAlias ?? null,
        ],
      );
      return result.rowCount === 1;
    });
    if (started) return;

    const runExists = await this.runExists(tenantId, request.runId);
    if (!runExists) throw new NodeExecutionRunNotFoundError(request.runId);
    throw new NodeExecutionStateConflictError(request.nodeExecutionId);
  }

  async recordSucceeded(
    request: Pick<NodeExecutionStart, "tenantId" | "runId" | "nodeExecutionId">,
  ): Promise<void> {
    await this.transition(request, "succeeded", null);
  }

  async recordFailed(
    request: Pick<NodeExecutionStart, "tenantId" | "runId" | "nodeExecutionId">,
    error: Record<string, unknown>,
  ): Promise<void> {
    await this.transition(request, "failed", error);
  }

  async list(
    tenantIdInput: string,
    runId: string,
    query: { readonly cursor?: string; readonly limit?: number } = {},
  ): Promise<NodeExecutionPage> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireRunId(runId);
    const cursor = requireCursor(query.cursor);
    const limit = normalizeLimit(query.limit);

    return this.store.withTenant(tenantId, async (tx) => {
      const run = await tx.query<RunRow>(
        "SELECT id FROM runs WHERE tenant_id = $1 AND id = $2",
        [tenantId, runId],
      );
      if (run.rowCount === 0) throw new NodeExecutionRunNotFoundError(runId);

      const cursorTimestamp =
        cursor === undefined
          ? undefined
          : await this.cursorTimestamp(tx, tenantId, runId, cursor);
      const result = await tx.query<NodeExecutionRecord>(
        cursorTimestamp === undefined
          ? `SELECT id, run_id, dag_node_id, node_type, attempt, model_alias,
                    model_resolved, status, input_ref, output_ref, error,
                    started_at::text, ended_at::text
             FROM node_executions
             WHERE tenant_id = $1 AND run_id = $2
             ORDER BY started_at ASC, id ASC
             LIMIT $3`
          : `SELECT id, run_id, dag_node_id, node_type, attempt, model_alias,
                    model_resolved, status, input_ref, output_ref, error,
                    started_at::text, ended_at::text
             FROM node_executions
             WHERE tenant_id = $1 AND run_id = $2
               AND (started_at, id) > ($3::timestamptz, $4)
             ORDER BY started_at ASC, id ASC
             LIMIT $5`,
        cursorTimestamp === undefined
          ? [tenantId, runId, limit + 1]
          : [tenantId, runId, cursorTimestamp, cursor, limit + 1],
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

  private async runExists(tenantId: string, runId: string): Promise<boolean> {
    return this.store.withTenant(tenantId, async (tx) => {
      const result = await tx.query<RunRow>(
        "SELECT id FROM runs WHERE tenant_id = $1 AND id = $2",
        [tenantId, runId],
      );
      return result.rowCount === 1;
    });
  }

  private async cursorTimestamp(
    tx: OrchestrationTransactionLike,
    tenantId: string,
    runId: string,
    cursor: string,
  ): Promise<string> {
    const result = await tx.query<{ readonly started_at: string }>(
      `SELECT started_at::text
       FROM node_executions
       WHERE tenant_id = $1 AND run_id = $2 AND id = $3`,
      [tenantId, runId, cursor],
    );
    const startedAt = result.rows[0]?.started_at;
    if (startedAt === undefined) {
      throw new NodeExecutionValidationError("cursor does not belong to this run");
    }
    return startedAt;
  }

  private async transition(
    request: Pick<NodeExecutionStart, "tenantId" | "runId" | "nodeExecutionId">,
    status: "succeeded" | "failed",
    error: Record<string, unknown> | null,
  ): Promise<void> {
    const tenantId = bareTenantUuid(request.tenantId);
    requireRunId(request.runId);
    requireNodeExecutionId(request.nodeExecutionId);
    const result = await this.store.withTenant(tenantId, async (tx) =>
      tx.query<NodeExecutionStateRow>(
        `UPDATE node_executions
         SET status = $4,
             error = $5::jsonb,
             ended_at = clock_timestamp()
         WHERE tenant_id = $1 AND run_id = $2 AND id = $3 AND status = 'running'
         RETURNING status`,
        [
          tenantId,
          request.runId,
          request.nodeExecutionId,
          status,
          error === null ? null : JSON.stringify(error),
        ],
      ),
    );
    if (result.rowCount !== 1) {
      throw new NodeExecutionStateConflictError(request.nodeExecutionId);
    }
  }
}
