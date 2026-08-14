import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type {
  CreateCredentialInput,
  CredentialRecord,
  UpdateCredentialInput,
} from "./types";

interface CredentialRow {
  tenant_id: string;
  id: string;
  name: string;
  connector: string;
  scope: string;
  last4: string;
  use_audit_ptr: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class CredentialRepository implements OnModuleDestroy {
  constructor(
    private readonly pool: Pool,
    private readonly closePoolOnDestroy = false,
  ) {}

  create(
    tenantId: string,
    id: string,
    input: Omit<CreateCredentialInput, "value">,
    last4: string,
  ): Promise<CredentialRecord> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<CredentialRow>(
        `INSERT INTO credential_refs
           (tenant_id, id, name, connector, scope, last4)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, id, input.name, input.connector, input.scope, last4],
      );
      return mapRow(result.rows[0]!);
    });
  }

  list(tenantId: string): Promise<CredentialRecord[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<CredentialRow>(
        `SELECT * FROM credential_refs
         WHERE tenant_id = $1 ORDER BY created_at DESC, id`,
        [tenantId],
      );
      return result.rows.map(mapRow);
    });
  }

  find(tenantId: string, id: string): Promise<CredentialRecord | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<CredentialRow>(
        `SELECT * FROM credential_refs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  update(
    tenantId: string,
    id: string,
    input: Omit<UpdateCredentialInput, "value">,
    last4?: string,
  ): Promise<CredentialRecord | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<CredentialRow>(
        `UPDATE credential_refs
         SET name = COALESCE($3, name),
             connector = COALESCE($4, connector),
             scope = COALESCE($5, scope),
             last4 = COALESCE($6, last4),
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          id,
          input.name ?? null,
          input.connector ?? null,
          input.scope ?? null,
          last4 ?? null,
        ],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM credential_refs WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return result.rowCount === 1;
    });
  }

  async recordUse(
    tenantId: string,
    credentialId: string,
    usedBy: string,
  ): Promise<string> {
    return this.withTenant(tenantId, async (client) => {
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO credential_use_audits
           (tenant_id, id, credential_id, used_by)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, auditId, credentialId, usedBy],
      );
      await client.query(
        `UPDATE credential_refs SET use_audit_ptr = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, credentialId, auditId],
      );
      return auditId;
    });
  }

  async getTenantRegion(tenantId: string): Promise<string> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<{ region: string }>(
        `SELECT region FROM tenants WHERE id = $1`,
        [tenantId],
      );
      if (!result.rows[0]) {
        throw new Error(`Tenant not found: ${tenantId}`);
      }
      return result.rows[0].region;
    });
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

function mapRow(row: CredentialRow): CredentialRecord {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    name: row.name,
    connector: row.connector,
    scope: row.scope,
    last4: row.last4,
    useAuditPtr: row.use_audit_ptr,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
