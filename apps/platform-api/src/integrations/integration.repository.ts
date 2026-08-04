import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { ConnectorId } from "./connectors";
import type { OAuthConnectionRecord, OAuthStateRecord } from "./types";

interface OAuthStateRow {
  tenant_id: string;
  id: string;
  workspace_id: string;
  connector: string;
  code_verifier: string | null;
  redirect_uri: string;
  created_by: string;
  created_at: Date;
  expires_at: Date;
}

interface OAuthConnectionRow {
  tenant_id: string;
  id: string;
  workspace_id: string;
  connector: string;
  external_account_id: string;
  scopes: string;
  status: string;
  last_health_status: string | null;
  last_health_checked_at: Date | null;
  revoked_at: Date | null;
  use_audit_ptr: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateOAuthStateInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly connector: ConnectorId;
  readonly codeVerifier: string | null;
  readonly redirectUri: string;
  readonly createdBy: string;
  readonly expiresAt: Date;
}

export interface CreateOAuthConnectionInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly connector: ConnectorId;
  readonly externalAccountId: string;
  readonly scopes: string;
}

@Injectable()
export class IntegrationRepository implements OnModuleDestroy {
  constructor(
    private readonly pool: Pool,
    private readonly closePoolOnDestroy = false,
  ) {}

  createState(
    tenantId: string,
    input: CreateOAuthStateInput,
  ): Promise<OAuthStateRecord> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<OAuthStateRow>(
        `INSERT INTO oauth_states
           (tenant_id, id, workspace_id, connector, code_verifier, redirect_uri, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          tenantId,
          input.id,
          input.workspaceId,
          input.connector,
          input.codeVerifier,
          input.redirectUri,
          input.createdBy,
          input.expiresAt,
        ],
      );
      return mapStateRow(result.rows[0]!);
    });
  }

  findState(
    tenantId: string,
    id: string,
  ): Promise<OAuthStateRecord | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<OAuthStateRow>(
        `SELECT * FROM oauth_states WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return result.rows[0] ? mapStateRow(result.rows[0]) : undefined;
    });
  }

  async deleteState(tenantId: string, id: string): Promise<void> {
    await this.withTenant(tenantId, async (client) => {
      await client.query(
        `DELETE FROM oauth_states WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
    });
  }

  createConnection(
    tenantId: string,
    input: CreateOAuthConnectionInput,
  ): Promise<OAuthConnectionRecord> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<OAuthConnectionRow>(
        `INSERT INTO oauth_connections
           (tenant_id, id, workspace_id, connector, external_account_id, scopes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          tenantId,
          input.id,
          input.workspaceId,
          input.connector,
          input.externalAccountId,
          input.scopes,
        ],
      );
      return mapConnectionRow(result.rows[0]!);
    });
  }

  listConnections(
    tenantId: string,
    workspaceId: string,
  ): Promise<OAuthConnectionRecord[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<OAuthConnectionRow>(
        `SELECT * FROM oauth_connections
         WHERE tenant_id = $1 AND workspace_id = $2
         ORDER BY created_at DESC, id`,
        [tenantId, workspaceId],
      );
      return result.rows.map(mapConnectionRow);
    });
  }

  findConnection(
    tenantId: string,
    workspaceId: string,
    id: string,
  ): Promise<OAuthConnectionRecord | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<OAuthConnectionRow>(
        `SELECT * FROM oauth_connections
         WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3`,
        [tenantId, workspaceId, id],
      );
      return result.rows[0] ? mapConnectionRow(result.rows[0]) : undefined;
    });
  }

  updateHealth(
    tenantId: string,
    workspaceId: string,
    id: string,
    status: string,
    checkedAt: Date,
  ): Promise<OAuthConnectionRecord | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<OAuthConnectionRow>(
        `UPDATE oauth_connections
         SET last_health_status = $4,
             last_health_checked_at = $5,
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3
         RETURNING *`,
        [tenantId, workspaceId, id, status, checkedAt],
      );
      return result.rows[0] ? mapConnectionRow(result.rows[0]) : undefined;
    });
  }

  revokeConnection(
    tenantId: string,
    workspaceId: string,
    id: string,
  ): Promise<OAuthConnectionRecord | undefined> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<OAuthConnectionRow>(
        `UPDATE oauth_connections
         SET status = 'revoked',
             revoked_at = clock_timestamp(),
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND workspace_id = $2 AND id = $3
         RETURNING *`,
        [tenantId, workspaceId, id],
      );
      return result.rows[0] ? mapConnectionRow(result.rows[0]) : undefined;
    });
  }

  async recordUse(
    tenantId: string,
    connectionId: string,
    usedBy: string,
    action: string,
  ): Promise<string> {
    return this.withTenant(tenantId, async (client) => {
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO oauth_connection_use_audits
           (tenant_id, id, connection_id, used_by, action)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, auditId, connectionId, usedBy, action],
      );
      await client.query(
        `UPDATE oauth_connections SET use_audit_ptr = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, connectionId, auditId],
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

function mapStateRow(row: OAuthStateRow): OAuthStateRecord {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    workspaceId: row.workspace_id,
    connector: row.connector as ConnectorId,
    codeVerifier: row.code_verifier,
    redirectUri: row.redirect_uri,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function mapConnectionRow(row: OAuthConnectionRow): OAuthConnectionRecord {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    workspaceId: row.workspace_id,
    connector: row.connector as ConnectorId,
    externalAccountId: row.external_account_id,
    scopes: row.scopes,
    status: row.status as OAuthConnectionRecord["status"],
    lastHealthStatus: row.last_health_status,
    lastHealthCheckedAt: row.last_health_checked_at,
    revokedAt: row.revoked_at,
    useAuditPtr: row.use_audit_ptr,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
