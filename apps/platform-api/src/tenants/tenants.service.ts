import type { ActorContext } from "../rbac/types";
import { PlatformHttpError } from "../signup/problem";
import { PlatformDb } from "../signup/platform-db";

export interface TenantView {
  id: string;
  name: string;
  status: string;
  region: string;
  role: string;
}

export class TenantsService {
  constructor(private readonly db: PlatformDb) {}

  list(actor: ActorContext): Promise<TenantView[]> {
    return this.db.queryTenant<TenantView>(
      actor.tenant_id,
      `SELECT t.id, t.name, t.status, t.region, tm.role
         FROM tenants t
         JOIN tenant_members tm ON tm.tenant_id = t.id
        WHERE tm.user_id = $1 AND t.id = $2
        ORDER BY t.created_at`,
      [actor.user_id, actor.tenant_id],
    );
  }

  async get(actor: ActorContext, tenantId: string): Promise<TenantView> {
    const rows = await this.db.queryTenant<TenantView>(
      tenantId,
      `SELECT t.id, t.name, t.status, t.region, tm.role
         FROM tenants t
         JOIN tenant_members tm ON tm.tenant_id = t.id
        WHERE t.id = $1 AND tm.user_id = $2
        LIMIT 1`,
      [tenantId, actor.user_id],
    );
    const tenant = rows[0];
    if (!tenant) {
      throw new PlatformHttpError(
        404,
        "TENANT_NOT_FOUND",
        "Tenant not found",
        `/api/v1/tenants/${tenantId}`,
      );
    }
    return tenant;
  }
}
