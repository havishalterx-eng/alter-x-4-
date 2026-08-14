import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  EntitlementAccessState,
  EntitlementLimits,
} from "./types";

export interface EntitlementRow {
  tenantId: string;
  plan: string;
  limits: Partial<EntitlementLimits> | null;
  accessState: EntitlementAccessState;
}

export interface EntitlementStore {
  findEffective(tenantId: string): Promise<EntitlementRow | null>;
  create(
    tenantId: string,
    plan: string,
    client?: PoolClient,
    options?: {
      accessState?: EntitlementAccessState;
      limits?: Partial<EntitlementLimits>;
    },
  ): Promise<EntitlementRow>;
}

// entitlements.tenant_id is a real `uuid` column; actorContext.tenant_id can
// arrive `ten_` prefixed (the engine-wide convention -- see
// packages/contracts/src/ids.ts) or bare (platform-api's own session, which
// doesn't prefix). Accept either.
function bareTenantId(tenantId: string): string {
  return tenantId.startsWith("ten_") ? tenantId.slice("ten_".length) : tenantId;
}

export class PostgresEntitlementStore implements EntitlementStore {
  constructor(private readonly pool: Pool) {}

  async findEffective(tenantId: string): Promise<EntitlementRow | null> {
    return this.inTenantTransaction(bareTenantId(tenantId), async (client, bareId) => {
      const result = await client.query<{
        tenant_id: string;
        plan: string;
        limits: Partial<EntitlementLimits> | null;
        access_state: EntitlementAccessState;
      }>(
        `SELECT tenant_id, plan, limits, access_state
           FROM entitlements
          WHERE tenant_id = $1
            AND (effective_from IS NULL OR effective_from <= now())
            AND (effective_to IS NULL OR effective_to > now())
          ORDER BY effective_from DESC NULLS LAST, created_at DESC
          LIMIT 1`,
        [bareId],
      );
      const row = result.rows[0];
      return row
        ? {
            tenantId: row.tenant_id,
            plan: row.plan,
            limits: row.limits,
            accessState: row.access_state,
          }
        : null;
    });
  }

  async create(
    tenantId: string,
    plan: string,
    transactionClient?: PoolClient,
    options: {
      accessState?: EntitlementAccessState;
      limits?: Partial<EntitlementLimits>;
    } = {},
  ): Promise<EntitlementRow> {
    const bareId = bareTenantId(tenantId);
    const insert = async (client: PoolClient): Promise<EntitlementRow> => {
      await client.query(
        `UPDATE entitlements
            SET effective_to = clock_timestamp()
          WHERE tenant_id = $1
            AND (effective_from IS NULL OR effective_from <= clock_timestamp())
            AND (effective_to IS NULL OR effective_to > clock_timestamp())`,
        [bareId],
      );
      const result = await client.query<{
        tenant_id: string;
        plan: string;
        limits: Partial<EntitlementLimits> | null;
        access_state: EntitlementAccessState;
      }>(
        `INSERT INTO entitlements
           (id, tenant_id, plan, limits, access_state, effective_from)
         VALUES ($1, $2, $3, $4::jsonb, $5, clock_timestamp())
         RETURNING tenant_id, plan, limits, access_state`,
        [
          randomUUID(),
          bareId,
          plan,
          JSON.stringify(options.limits ?? {}),
          options.accessState ?? "active",
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Entitlement insert returned no row");
      }
      return {
        tenantId: row.tenant_id,
        plan: row.plan,
        limits: row.limits,
        accessState: row.access_state,
      };
    };

    return transactionClient
      ? insert(transactionClient)
      : this.inTenantTransaction(bareId, (client) => insert(client));
  }

  private async inTenantTransaction<T>(
    tenantId: string,
    operation: (client: PoolClient, tenantId: string) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
        tenantId,
      ]);
      const value = await operation(client, tenantId);
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
