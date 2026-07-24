import type { OnModuleDestroy } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { IdempotencyHttpError } from "./problem";

export interface StoredHttpResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyResult extends StoredHttpResponse {
  replayed: boolean;
}

export interface IdempotencyExecution {
  tenantId: string;
  key: string;
  fingerprint: string;
  instance: string;
}

interface IdempotencyRow {
  request_fingerprint: string;
  response_status: number;
  response_body: unknown;
  expires_at: Date;
}

export class PgIdempotencyStore implements OnModuleDestroy {
  constructor(
    private readonly pool: Pool,
    private readonly ttlMilliseconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly closePoolOnDestroy = false,
  ) {
    if (!Number.isSafeInteger(ttlMilliseconds) || ttlMilliseconds <= 0) {
      throw new Error("Idempotency TTL must be a positive integer");
    }
  }

  async execute(
    execution: IdempotencyExecution,
    operation: () => Promise<StoredHttpResponse>,
  ): Promise<IdempotencyResult> {
    if (!execution.key.trim()) {
      throw new IdempotencyHttpError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Key header required",
        execution.instance,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [execution.tenantId],
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${execution.tenantId}:${execution.key}`],
      );

      const existing = await this.findExisting(client, execution);
      const currentTime = this.now();
      if (existing && existing.expires_at > currentTime) {
        if (existing.request_fingerprint !== execution.fingerprint) {
          throw new IdempotencyHttpError(
            422,
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency key was already used with a different request",
            execution.instance,
          );
        }

        await client.query("COMMIT");
        return {
          status: existing.response_status,
          body: existing.response_body,
          replayed: true,
        };
      }

      if (existing) {
        await client.query(
          `DELETE FROM idempotency_keys
            WHERE tenant_id = $1 AND idempotency_key = $2`,
          [execution.tenantId, execution.key],
        );
      }

      const response = await operation();
      assertResponseStatus(response.status);
      await client.query(
        `INSERT INTO idempotency_keys
          (tenant_id, idempotency_key, request_fingerprint,
           response_status, response_body, expires_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          execution.tenantId,
          execution.key,
          execution.fingerprint,
          response.status,
          JSON.stringify(response.body ?? null),
          new Date(currentTime.getTime() + this.ttlMilliseconds),
        ],
      );
      await client.query("COMMIT");
      return { ...response, replayed: false };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closePoolOnDestroy) {
      await this.pool.end();
    }
  }

  private async findExisting(
    client: PoolClient,
    execution: IdempotencyExecution,
  ): Promise<IdempotencyRow | undefined> {
    const result = await client.query<IdempotencyRow>(
      `SELECT request_fingerprint, response_status, response_body, expires_at
         FROM idempotency_keys
        WHERE tenant_id = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [execution.tenantId, execution.key],
    );
    return result.rows[0];
  }
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve original operation or database error.
  }
}

function assertResponseStatus(status: number): void {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error("Idempotency operation returned invalid HTTP status");
  }
}
