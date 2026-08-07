import {
  RecoveryActionIdSchema,
  RunIdSchema,
  TenantIdSchema,
  VerificationResultIdSchema,
} from "@alterx/contracts";

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

export interface RunObservabilityPage {
  readonly data: readonly Record<string, unknown>[];
  readonly page: {
    readonly next_cursor: string | null;
    readonly has_more: boolean;
    readonly limit: number;
  };
}

export class RunObservabilityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunObservabilityValidationError";
  }
}

export class RunObservabilityRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} was not found`);
    this.name = "RunObservabilityRunNotFoundError";
  }
}

type Collection = "verification-results" | "recovery-actions" | "quality-gates";

interface CollectionDefinition {
  readonly table: "verification_results" | "recovery_actions";
  readonly idColumn: "id";
  readonly cursorValid: (cursor: string) => boolean;
  readonly fields: string;
  readonly extraWhere: string;
}

const collections: Record<Collection, CollectionDefinition> = {
  "verification-results": {
    table: "verification_results",
    idColumn: "id",
    cursorValid: (cursor) => VerificationResultIdSchema.safeParse(cursor).success,
    fields: "id, run_id, node_execution_id, gate_type, verdict, score::text, threshold::text, reviewer_model, details, created_at::text",
    extraWhere: "",
  },
  "recovery-actions": {
    table: "recovery_actions",
    idColumn: "id",
    cursorValid: (cursor) => RecoveryActionIdSchema.safeParse(cursor).success,
    fields: "id, run_id, node_execution_id, failure_class, root_cause_estimate, strategy, policy_version, outcome, created_at::text, resolved_at::text",
    extraWhere: "",
  },
  // Quality gates are a read projection of persisted verification results.
  // The Engine does not manufacture a second status store for this view.
  "quality-gates": {
    table: "verification_results",
    idColumn: "id",
    cursorValid: (cursor) => VerificationResultIdSchema.safeParse(cursor).success,
    fields: "id, run_id, node_execution_id, gate_type, verdict, score::text, threshold::text, reviewer_model, details, created_at::text",
    extraWhere: " AND gate_type IN ('quality', 'build', 'render', 'security', 'acceptance')",
  },
};

function bareTenantUuid(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new RunObservabilityValidationError("tenantId must be a ten_ prefixed UUIDv7");
  }
  return parsed.data.slice("ten_".length);
}

function requireRunId(runId: string): void {
  if (!RunIdSchema.safeParse(runId).success) {
    throw new RunObservabilityValidationError("runId must be a run_ prefixed UUIDv7");
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new RunObservabilityValidationError("limit must be an integer from 1 to 200");
  }
  return limit;
}

/** Real, read-only views over verification_results and recovery_actions. */
export class RunObservabilityService {
  constructor(private readonly store: OrchestrationTenantStore) {}

  verificationResults(tenantId: string, runId: string, query: { cursor?: string; limit?: number } = {}) {
    return this.list("verification-results", tenantId, runId, query);
  }

  recoveryActions(tenantId: string, runId: string, query: { cursor?: string; limit?: number } = {}) {
    return this.list("recovery-actions", tenantId, runId, query);
  }

  qualityGates(tenantId: string, runId: string, query: { cursor?: string; limit?: number } = {}) {
    return this.list("quality-gates", tenantId, runId, query);
  }

  private async list(
    collection: Collection,
    tenantIdInput: string,
    runId: string,
    query: { cursor?: string; limit?: number },
  ): Promise<RunObservabilityPage> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireRunId(runId);
    const limit = normalizeLimit(query.limit);
    const definition = collections[collection];
    if (query.cursor !== undefined && !definition.cursorValid(query.cursor)) {
      throw new RunObservabilityValidationError("cursor is invalid for this collection");
    }

    return this.store.withTenant(tenantId, async (tx) => {
      const run = await tx.query<{ readonly id: string }>(
        "SELECT id FROM runs WHERE tenant_id = $1 AND id = $2",
        [tenantId, runId],
      );
      if (run.rowCount === 0) throw new RunObservabilityRunNotFoundError(runId);

      let cursorCreatedAt: string | undefined;
      if (query.cursor !== undefined) {
        const cursor = await tx.query<{ readonly created_at: string }>(
          `SELECT created_at::text FROM ${definition.table}
           WHERE tenant_id = $1 AND run_id = $2 AND ${definition.idColumn} = $3${definition.extraWhere}`,
          [tenantId, runId, query.cursor],
        );
        cursorCreatedAt = cursor.rows[0]?.created_at;
        if (cursorCreatedAt === undefined) {
          throw new RunObservabilityValidationError("cursor does not belong to this run");
        }
      }

      const result = await tx.query<Record<string, unknown>>(
        cursorCreatedAt === undefined
          ? `SELECT ${definition.fields} FROM ${definition.table}
             WHERE tenant_id = $1 AND run_id = $2${definition.extraWhere}
             ORDER BY created_at ASC, id ASC LIMIT $3`
          : `SELECT ${definition.fields} FROM ${definition.table}
             WHERE tenant_id = $1 AND run_id = $2${definition.extraWhere}
               AND (created_at, id) > ($3::timestamptz, $4)
             ORDER BY created_at ASC, id ASC LIMIT $5`,
        cursorCreatedAt === undefined
          ? [tenantId, runId, limit + 1]
          : [tenantId, runId, cursorCreatedAt, query.cursor, limit + 1],
      );
      const rows = [...result.rows];
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;
      return {
        data,
        page: {
          next_cursor: hasMore ? (data.at(-1)?.["id"] as string | undefined) ?? null : null,
          has_more: hasMore,
          limit,
        },
      };
    });
  }
}
