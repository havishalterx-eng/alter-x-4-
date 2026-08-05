import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export interface StaffUser {
  id: string;
  identity_ref: string;
  email: string;
  roles: string[];
}

export interface JitGrant {
  id: string;
  staff_user_id: string;
  tenant_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

export class StaffRepository {
  constructor(private readonly pool: Pool) {}

  async find(identityRef: string): Promise<StaffUser | undefined> {
    const result = await this.pool.query<StaffUser>(
      "SELECT id, identity_ref, email, roles FROM staff_users WHERE identity_ref = $1 AND deactivated_at IS NULL",
      [identityRef],
    );
    return result.rows[0];
  }

  async grant(
    id: string,
    staffUserId: string,
    tenantId: string,
    reasonCode: string,
    reasonText: string,
    expiresAt: Date,
  ): Promise<JitGrant> {
    return this.transaction(async (client) => {
      const result = await client.query<JitGrant>(
        "INSERT INTO jit_grants (id, staff_user_id, tenant_id, reason_code, reason_text, expires_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [id, staffUserId, tenantId, reasonCode, reasonText, expiresAt],
      );
      await this.audit(client, id, "granted", staffUserId);
      return result.rows[0]!;
    });
  }

  async revoke(id: string, actorId: string): Promise<JitGrant | undefined> {
    return this.transaction(async (client) => {
      const result = await client.query<JitGrant>(
        "UPDATE jit_grants SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING *",
        [id, actorId],
      );
      const grant = result.rows[0];
      if (grant) {
        await this.audit(client, id, "revoked", actorId);
      }
      return grant;
    });
  }

  async active(staffUserId: string, tenantId: string): Promise<JitGrant | undefined> {
    return this.transaction(async (client) => {
      const result = await client.query<JitGrant>(
        "SELECT * FROM jit_grants WHERE staff_user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL ORDER BY expires_at DESC LIMIT 1",
        [staffUserId, tenantId],
      );
      const grant = result.rows[0];
      if (!grant) {
        return undefined;
      }

      if (grant.expires_at <= new Date()) {
        await client.query(
          "INSERT INTO jit_grant_audit (id, jit_grant_id, action, actor_id) SELECT $1, $2, 'expired', $3 WHERE NOT EXISTS (SELECT 1 FROM jit_grant_audit WHERE jit_grant_id = $2 AND action = 'expired')",
          [`jta_${randomUUID()}`, grant.id, staffUserId],
        );
        return undefined;
      }

      await this.audit(client, grant.id, "used", staffUserId);
      return grant;
    });
  }

  async list(staffUserId: string, includeAll: boolean): Promise<JitGrant[]> {
    const result = includeAll
      ? await this.pool.query<JitGrant>("SELECT * FROM jit_grants ORDER BY granted_at DESC")
      : await this.pool.query<JitGrant>(
          "SELECT * FROM jit_grants WHERE staff_user_id = $1 ORDER BY granted_at DESC",
          [staffUserId],
        );
    return result.rows;
  }

  private async audit(
    client: PoolClient,
    grantId: string,
    action: "granted" | "used" | "expired" | "revoked",
    actorId: string,
  ): Promise<void> {
    await client.query(
      "INSERT INTO jit_grant_audit (id, jit_grant_id, action, actor_id) VALUES ($1, $2, $3, $4)",
      [`jta_${randomUUID()}`, grantId, action, actorId],
    );
  }

  private async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
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
