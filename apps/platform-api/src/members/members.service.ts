import { randomUUID } from "node:crypto";
import type { ActorContext } from "../rbac/types";
import { tenantRoleAllows } from "../rbac/types";
import { PlatformDb } from "../signup/platform-db";
import { PlatformHttpError } from "../signup/problem";

export interface MemberView {
  id: string;
  tenantId: string;
  workspaceId: string | null;
  userId: string;
  role: string;
  scope: "tenant" | "workspace";
}

export interface InviteMemberInput {
  userId: string;
  role: string;
  workspaceId?: string;
}

export class MembersService {
  constructor(private readonly db: PlatformDb) {}

  async list(actor: ActorContext): Promise<MemberView[]> {
    const tenant = await this.db.queryTenant<MemberView>(
      actor.tenant_id,
      `SELECT id, tenant_id AS "tenantId", NULL::uuid AS "workspaceId",
              user_id AS "userId", role, 'tenant' AS scope
         FROM tenant_members WHERE tenant_id = $1`,
      [actor.tenant_id],
    );
    const workspace = await this.db.queryTenant<MemberView>(
      actor.tenant_id,
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId",
              user_id AS "userId", role, 'workspace' AS scope
         FROM workspace_members WHERE tenant_id = $1`,
      [actor.tenant_id],
    );
    return [...tenant, ...workspace];
  }

  async invite(actor: ActorContext, input: InviteMemberInput): Promise<MemberView> {
    assertAdmin(actor);
    if (!input.userId || !input.role) {
      throw new PlatformHttpError(
        400,
        "INVALID_MEMBER_INVITE",
        "userId and role required",
        "/api/v1/members",
      );
    }
    const workspace = Boolean(input.workspaceId);
    const rows = await this.db.queryTenant<MemberView>(
      actor.tenant_id,
      workspace
        ? `INSERT INTO workspace_members
             (id, tenant_id, workspace_id, user_id, role)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, tenant_id AS "tenantId",
             workspace_id AS "workspaceId", user_id AS "userId", role,
             'workspace' AS scope`
        : `INSERT INTO tenant_members (id, tenant_id, user_id, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, tenant_id AS "tenantId", NULL::uuid AS "workspaceId",
             user_id AS "userId", role, 'tenant' AS scope`,
      workspace
        ? [randomUUID(), actor.tenant_id, input.workspaceId, input.userId, input.role]
        : [randomUUID(), actor.tenant_id, input.userId, input.role],
    );
    const member = rows[0];
    if (!member) throw new Error("Member insert returned no row");
    return member;
  }

  async remove(actor: ActorContext, memberId: string, scope: string): Promise<void> {
    assertAdmin(actor);
    const table = scope === "workspace" ? "workspace_members" : "tenant_members";
    await this.db.queryTenant(
      actor.tenant_id,
      `DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2`,
      [memberId, actor.tenant_id],
    );
  }
}

function assertAdmin(actor: ActorContext): void {
  const allowed = actor.roles.some(
    (role) => tenantRoleAllows(role, "admin"),
  );
  if (!allowed) {
    throw new PlatformHttpError(
      403,
      "MEMBER_MANAGEMENT_FORBIDDEN",
      "Owner or admin role required",
      "/api/v1/members",
    );
  }
}
