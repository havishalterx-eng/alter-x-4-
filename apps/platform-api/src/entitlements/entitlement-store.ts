import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { EntitlementLimits } from "./types";

export interface EntitlementRow {
  tenantId: string;
  plan: string;
  limits: Partial<EntitlementLimits> | null;
}

export interface EntitlementStore {
  findEffective(tenantId: string): Promise<EntitlementRow | null>;
  create(tenantId: string, plan: string): Promise<EntitlementRow>;
}

export class PostgresEntitlementStore implements EntitlementStore {
  constructor(private readonly pool: Pool) {}

  async findEffective(tenantId: string): Promise<EntitlementRow | null> {
    return this.inTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{
        tenant_id: string;
        plan: string;
        limits: Partial<EntitlementLimits> | null;
      }>(
        `SELECT tenant_id, plan, limits
           FROM entitlements
          WHERE tenant_id = $1
            AND (effective_from IS NULL OR effective_from <= now())
            AND (effective_to IS NULL OR effective_to > now())
          ORDER BY effective_from DESC NULLS LAST, created_at DESC
          LIMIT 1`,
        [tenantId],
      );
      const row = result.rows[0];
      return row
        ? { tenantId: row.tenant_id, plan: row.plan, limits: row.limits }
        : null;
    });
  }

  async create(tenantId: string, plan: string): Promise<EntitlementRow> {
    return this.inTenantTransaction(tenantId, async (client) => {
      const result = await client.query<{
        tenant_id: string;
        plan: string;
        limits: Partial<EntitlementLimits> | null;
      }>(
        `INSERT INTO entitlements (id, tenant_id, plan, limits, effective_from)
         VALUES ($1, $2, $3, '{}'::jsonb, now())
         RETURNING tenant_id, plan, limits`,
        [randomUUID(), tenantId, plan],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Entitlement insert returned no row");
      }
      return { tenantId: row.tenant_id, plan: row.plan, limits: row.limits };
    });
  }

  private async inTenantTransaction<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
        tenantId,
      ]);
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
