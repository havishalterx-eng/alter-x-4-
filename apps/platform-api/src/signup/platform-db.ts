import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  CreateSignupInput,
  ExistingSignup,
  SignupPersistence,
} from "./types";

export class PlatformDb implements SignupPersistence {
  constructor(private readonly pool: Pool) {}

  async findExisting(
    identityRef: string,
    tenantHint: string,
  ): Promise<ExistingSignup | null> {
    const user = await this.pool.query<{ id: string }>(
      "SELECT id FROM users WHERE identity_ref = $1 LIMIT 1",
      [identityRef],
    );
    const userId = user.rows[0]?.id;
    if (!userId) return null;

    const validTenantHint = isUuid(tenantHint) ? tenantHint : null;
    const result = await this.pool.query<ExistingSignup>(
      `SELECT tm.user_id AS "userId", tm.tenant_id AS "tenantId",
              wm.workspace_id AS "workspaceId", tm.role AS "tenantRole",
              wm.role AS "workspaceRole"
         FROM tenant_members tm
         JOIN workspace_members wm
           ON wm.tenant_id = tm.tenant_id AND wm.user_id = tm.user_id
        WHERE tm.user_id = $1
        ORDER BY CASE WHEN tm.tenant_id = $2::uuid THEN 0 ELSE 1 END,
                 tm.created_at DESC, wm.created_at DESC
        LIMIT 1`,
      [userId, validTenantHint],
    );
    return result.rows[0] ?? null;
  }

  async createSignup<T>(
    input: CreateSignupInput,
    beforeCommit: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.transaction(input.tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenants
          (id, name, status, identity_org_ref, security_policy)
         VALUES ($1, $2, 'active', $3, $4::jsonb)`,
        [
          input.tenantId,
          input.tenantName,
          input.identityOrgRef,
          JSON.stringify({ onboarding: { status: "not_started" } }),
        ],
      );
      await client.query(
        `INSERT INTO users (id, identity_ref, email, display_name, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [input.userId, input.identityRef, input.email, input.displayName ?? null],
      );
      await client.query(
        `INSERT INTO workspaces (id, tenant_id, name, status)
         VALUES ($1, $2, 'Default', 'active')`,
        [input.workspaceId, input.tenantId],
      );
      await client.query(
        `INSERT INTO tenant_members (id, tenant_id, user_id, role)
         VALUES (gen_random_uuid(), $1, $2, 'owner')`,
        [input.tenantId, input.userId],
      );
      await client.query(
        `INSERT INTO workspace_members
          (id, tenant_id, workspace_id, user_id, role)
         VALUES (gen_random_uuid(), $1, $2, $3, 'admin')`,
        [input.tenantId, input.workspaceId, input.userId],
      );
      return beforeCommit(client);
    });
  }

  async withTenant<T>(
    tenantId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.transaction(tenantId, operation);
  }

  async queryTenant<T extends QueryResultRow>(
    tenantId: string,
    sql: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query<T>(sql, values);
      return result.rows;
    });
  }

  private async transaction<T>(
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
