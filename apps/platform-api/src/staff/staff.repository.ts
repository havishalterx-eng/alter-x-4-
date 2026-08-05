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

export interface TenantJitGrant {
  id: string;
  reason_code: string;
  reason_text: string;
  granted_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  staff_roles: string[];
}

export interface TenantJitGrantPage {
  data: TenantJitGrant[];
  page: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
}

export class InvalidSupportAccessCursorError extends Error {
  constructor() {
    super("Invalid support access cursor");
    this.name = "InvalidSupportAccessCursorError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
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

  async listForTenant(
    tenantId: string,
    input: { readonly cursor?: string | undefined; readonly limit: number },
  ): Promise<TenantJitGrantPage> {
    const cursor = input.cursor ? decodeTenantGrantCursor(input.cursor) : undefined;
    return this.transaction(async (client) => {
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const result = await client.query<TenantJitGrant>(
        `SELECT g.id, g.reason_code, g.reason_text, g.granted_at, g.expires_at, g.revoked_at,
                COALESCE(s.roles, ARRAY[]::text[]) AS staff_roles
           FROM jit_grants g
           LEFT JOIN staff_users s ON s.id = g.staff_user_id
          WHERE g.tenant_id = $1
            AND ($2::timestamptz IS NULL OR (g.granted_at, g.id) < ($2, $3))
          ORDER BY g.granted_at DESC, g.id DESC
          LIMIT $4`,
        [tenantId, cursor?.grantedAt ?? null, cursor?.id ?? null, input.limit + 1],
      );
      const data = result.rows.slice(0, input.limit);
      const tail = data.at(-1);
      const nextCursor = result.rows.length > input.limit && tail
        ? encodeTenantGrantCursor(tail.granted_at, tail.id)
        : null;
      return {
        data,
        page: { next_cursor: nextCursor, has_more: nextCursor !== null, limit: input.limit },
      };
    });
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

function encodeTenantGrantCursor(grantedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ grantedAt: grantedAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeTenantGrantCursor(cursor: string): { readonly grantedAt: string; readonly id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
    if (
      typeof record?.grantedAt !== "string" ||
      typeof record.id !== "string" ||
      Number.isNaN(Date.parse(record.grantedAt))
    ) {
      throw new Error("invalid cursor");
    }
    return { grantedAt: record.grantedAt, id: record.id };
  } catch {
    throw new InvalidSupportAccessCursorError();
  }
}
