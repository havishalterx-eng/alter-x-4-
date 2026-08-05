import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { AdminTenantView } from "./types";

interface TenantRow {
  id: string;
  name: string;
  status: string;
  region: string;
  identity_org_ref: string | null;
  created_at: Date;
}

export type TenantAdminAction =
  | "provisioned"
  | "suspended"
  | "reinstated"
  | "entitlement_overridden";

@Injectable()
export class AdminTenantsRepository implements OnModuleDestroy {
  constructor(
    private readonly pool: Pool,
    private readonly closePoolOnDestroy = false,
  ) {}

  async createTenant(
    id: string,
    name: string,
    identityOrgRef: string,
    region: string,
  ): Promise<AdminTenantView> {
    return this.withTenant(id, async (client) => {
      const result = await client.query<TenantRow>(
        `INSERT INTO tenants (id, name, status, region, identity_org_ref)
         VALUES ($1, $2, 'active', $3, $4)
         RETURNING id, name, status, region, identity_org_ref, created_at`,
        [id, name, region, identityOrgRef],
      );
      return mapRow(result.rows[0]!);
    });
  }

  /**
   * Cross-tenant by design (staff admin plane) — relays through the
   * `admin_list_tenants()` SECURITY DEFINER function (row_security off,
   * owned by platform_provisioner), same RLS-bypass pattern already used
   * by `resolve_existing_signup()`. Never query "tenants" directly for a
   * cross-tenant read; FORCE RLS on that table default-denies otherwise.
   */
  async list(): Promise<AdminTenantView[]> {
    const result = await this.pool.query<TenantRow>(
      `SELECT * FROM admin_list_tenants()`,
    );
    return result.rows.map(mapRow);
  }

  async find(id: string): Promise<AdminTenantView | undefined> {
    return this.withTenant(id, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT id, name, status, region, identity_org_ref, created_at
         FROM tenants WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  async setStatus(
    id: string,
    status: "active" | "suspended",
  ): Promise<AdminTenantView | undefined> {
    return this.withTenant(id, async (client) => {
      const result = await client.query<TenantRow>(
        `UPDATE tenants SET status = $2, updated_at = clock_timestamp()
         WHERE id = $1
         RETURNING id, name, status, region, identity_org_ref, created_at`,
        [id, status],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  async recordAction(
    tenantId: string,
    staffUserId: string,
    action: TenantAdminAction,
    reason: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO tenant_admin_actions (id, tenant_id, staff_user_id, action, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [`taa_${randomUUID()}`, tenantId, staffUserId, action, reason],
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.closePoolOnDestroy) await this.pool.end();
  }

  private async withTenant<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [tenantId],
      );
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapRow(row: TenantRow): AdminTenantView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    region: row.region,
    identity_org_ref: row.identity_org_ref,
    created_at: row.created_at.toISOString(),
  };
}
