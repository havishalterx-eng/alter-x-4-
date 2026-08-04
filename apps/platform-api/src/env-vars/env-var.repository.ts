import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type {
  CreateEnvVarInput,
  EnvVarRecord,
  UpdateEnvVarInput,
} from "./types";

interface EnvVarRow {
  tenant_id: string;
  id: string;
  project_id: string;
  environment: string;
  key: string;
  last4: string;
  use_audit_ptr: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class EnvVarRepository implements OnModuleDestroy {
  constructor(
    private readonly pool: Pool,
    private readonly closePoolOnDestroy = false,
  ) {}

  create(
    tenantId: string,
    id: string,
    projectId: string,
    input: Omit<CreateEnvVarInput, "value">,
    last4: string,
  ): Promise<EnvVarRecord> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<EnvVarRow>(
        `INSERT INTO env_vars
           (tenant_id, id, project_id, environment, key, last4)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, id, projectId, input.environment, input.key, last4],
      );
      return mapRow(result.rows[0]!);
    });
  }

  list(tenantId: string, projectId: string): Promise<EnvVarRecord[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<EnvVarRow>(
        `SELECT * FROM env_vars
         WHERE tenant_id = $1 AND project_id = $2
         ORDER BY environment, key, id`,
        [tenantId, projectId],
      );
      return result.rows.map(mapRow);
    });
  }

  find(
    tenantId: string,
    projectId: string,
    id: string,
  ): Promise<EnvVarRecord | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<EnvVarRow>(
        `SELECT * FROM env_vars
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [tenantId, projectId, id],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  update(
    tenantId: string,
    projectId: string,
    id: string,
    input: Omit<UpdateEnvVarInput, "value">,
    last4?: string,
  ): Promise<EnvVarRecord | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<EnvVarRow>(
        `UPDATE env_vars
         SET environment = COALESCE($4, environment),
             key = COALESCE($5, key),
             last4 = COALESCE($6, last4),
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3
         RETURNING *`,
        [
          tenantId,
          projectId,
          id,
          input.environment ?? null,
          input.key ?? null,
          last4 ?? null,
        ],
      );
      return result.rows[0] ? mapRow(result.rows[0]) : undefined;
    });
  }

  async delete(
    tenantId: string,
    projectId: string,
    id: string,
  ): Promise<boolean> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM env_vars
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [tenantId, projectId, id],
      );
      return result.rowCount === 1;
    });
  }

  async recordUse(
    tenantId: string,
    envVarId: string,
    usedBy: string,
  ): Promise<string> {
    return this.withTenant(tenantId, async (client) => {
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO env_var_use_audits
           (tenant_id, id, env_var_id, used_by)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, auditId, envVarId, usedBy],
      );
      await client.query(
        `UPDATE env_vars SET use_audit_ptr = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, envVarId, auditId],
      );
      return auditId;
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

function mapRow(row: EnvVarRow): EnvVarRecord {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    projectId: row.project_id,
    environment: row.environment,
    key: row.key,
    last4: row.last4,
    useAuditPtr: row.use_audit_ptr,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
