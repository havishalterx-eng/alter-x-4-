import { TenantIdSchema } from "@alterx/contracts";

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

export class ClarificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarificationValidationError";
  }
}

export class ClarificationNotFoundError extends Error {
  constructor(clarificationId: string) {
    super(`Clarification ${clarificationId} was not found`);
    this.name = "ClarificationNotFoundError";
  }
}

export class ClarificationStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarificationStateConflictError";
  }
}

export interface ClarificationRow extends Record<string, unknown> {
  readonly id: string;
  readonly conversation_id: string;
  readonly question: string;
  readonly status: "open" | "answered" | "expired";
  readonly assignee_user_id: string | null;
  readonly assigned_at: string | null;
  readonly requested_at: string;
  readonly answered_at: string | null;
  readonly expiry_at: string;
}

export interface ClarificationPage {
  readonly data: readonly ClarificationRow[];
  readonly page: {
    readonly next_cursor: string | null;
    readonly has_more: boolean;
    readonly limit: number;
  };
}

const SELECT_COLUMNS = `id, conversation_id, question, status, assignee_user_id::text,
       assigned_at::text, requested_at::text, answered_at::text, expiry_at::text`;

function bareTenantUuid(tenantId: string): string {
  const parsed = TenantIdSchema.safeParse(tenantId);
  if (!parsed.success) {
    throw new ClarificationValidationError("tenantId must be a ten_ prefixed UUIDv7");
  }
  return parsed.data.slice("ten_".length);
}

function bareUserUuid(userId: string): string {
  if (!/^usr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new ClarificationValidationError("assignee_user_id must be a usr_ prefixed UUIDv7");
  }
  return userId.slice("usr_".length);
}

function requireClarificationId(clarificationId: string): void {
  if (!/^clr_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clarificationId)) {
    throw new ClarificationValidationError("clarificationId must be a clr_ prefixed UUIDv7");
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ClarificationValidationError("limit must be an integer from 1 to 200");
  }
  return limit;
}

export class ClarificationsService {
  constructor(private readonly store: OrchestrationTenantStore) {}

  async list(
    tenantIdInput: string,
    query: { readonly cursor?: string; readonly limit?: number } = {},
  ): Promise<ClarificationPage> {
    const tenantId = bareTenantUuid(tenantIdInput);
    const limit = normalizeLimit(query.limit);

    return this.store.withTenant(tenantId, async (tx) => {
      await this.#expirePastDue(tx, tenantId);
      const values: unknown[] = [tenantId];
      let cursorClause = "";
      if (query.cursor !== undefined) {
        requireClarificationId(query.cursor);
        const cursor = await tx.query<{ readonly requested_at: string }>(
          "SELECT requested_at::text FROM clarifications WHERE tenant_id = $1 AND id = $2",
          [tenantId, query.cursor],
        );
        const requestedAt = cursor.rows[0]?.requested_at;
        if (requestedAt === undefined) {
          throw new ClarificationValidationError("cursor does not belong to this tenant");
        }
        values.push(requestedAt, query.cursor);
        cursorClause = ` AND (requested_at, id) > ($2::timestamptz, $3)`;
      }
      values.push(limit + 1);
      const rows = await tx.query<ClarificationRow>(
        `SELECT ${SELECT_COLUMNS}
         FROM clarifications
         WHERE tenant_id = $1 AND status = 'open'${cursorClause}
         ORDER BY requested_at ASC, id ASC
         LIMIT $${values.length}`,
        values,
      );
      const pageRows = [...rows.rows];
      const hasMore = pageRows.length > limit;
      const data = hasMore ? pageRows.slice(0, limit) : pageRows;
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

  async assign(
    tenantIdInput: string,
    clarificationId: string,
    assigneeUserId: string | null,
  ): Promise<ClarificationRow> {
    const tenantId = bareTenantUuid(tenantIdInput);
    requireClarificationId(clarificationId);
    const assignee = assigneeUserId === null ? null : bareUserUuid(assigneeUserId);

    return this.store.withTenant(tenantId, async (tx) => {
      await this.#expireIfPast(tx, tenantId, clarificationId);
      const updated = await tx.query<ClarificationRow>(
        `UPDATE clarifications
         SET assignee_user_id = $3,
             assigned_at = CASE WHEN $3::uuid IS NULL THEN NULL ELSE clock_timestamp() END
         WHERE tenant_id = $1 AND id = $2 AND status = 'open'
         RETURNING ${SELECT_COLUMNS}`,
        [tenantId, clarificationId, assignee],
      );
      const row = updated.rows[0];
      if (row !== undefined) return row;

      const current = await this.#find(tx, tenantId, clarificationId);
      if (current === undefined) throw new ClarificationNotFoundError(clarificationId);
      throw new ClarificationStateConflictError(
        `clarification ${clarificationId} is already "${current.status}" and cannot be assigned`,
      );
    });
  }

  async #expirePastDue(tx: OrchestrationTransactionLike, tenantId: string): Promise<void> {
    await tx.query(
      `UPDATE clarifications
       SET status = 'expired'
       WHERE tenant_id = $1 AND status = 'open' AND expiry_at < clock_timestamp()`,
      [tenantId],
    );
  }

  async #expireIfPast(
    tx: OrchestrationTransactionLike,
    tenantId: string,
    clarificationId: string,
  ): Promise<void> {
    await tx.query(
      `UPDATE clarifications
       SET status = 'expired'
       WHERE tenant_id = $1 AND id = $2 AND status = 'open' AND expiry_at < clock_timestamp()`,
      [tenantId, clarificationId],
    );
  }

  async #find(
    tx: OrchestrationTransactionLike,
    tenantId: string,
    clarificationId: string,
  ): Promise<ClarificationRow | undefined> {
    const result = await tx.query<ClarificationRow>(
      `SELECT ${SELECT_COLUMNS} FROM clarifications WHERE tenant_id = $1 AND id = $2`,
      [tenantId, clarificationId],
    );
    return result.rows[0];
  }
}
