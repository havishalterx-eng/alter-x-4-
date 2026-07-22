import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { IdentityService } from "../identity/identity.service";
import type { RbacRequest } from "../rbac/types";
import { PlatformDb } from "./platform-db";

interface RoleRow {
  role: string;
  workspaceId: string | null;
}

@Injectable()
export class SignupActorContextMiddleware implements NestMiddleware {
  constructor(
    private readonly identityService: IdentityService,
    private readonly db: PlatformDb,
  ) {}

  async use(
    request: FastifyRequest & RbacRequest,
    _reply: FastifyReply,
    next: () => void,
  ): Promise<void> {
    void _reply;
    const accessToken = readCookie(request.headers.cookie, "alter_access");
    if (!accessToken) {
      next();
      return;
    }

    try {
      const session = await this.identityService.authenticateAccessToken(accessToken);
      const tenantRoles = await this.db.queryTenant<RoleRow>(
        session.tenantId,
        `SELECT role, NULL::uuid AS "workspaceId"
           FROM tenant_members
          WHERE tenant_id = $1 AND user_id = $2`,
        [session.tenantId, session.userId],
      );
      const workspaceRoles = await this.db.queryTenant<RoleRow>(
        session.tenantId,
        `SELECT role, workspace_id AS "workspaceId"
           FROM workspace_members
          WHERE tenant_id = $1 AND user_id = $2`,
        [session.tenantId, session.userId],
      );
      request.actorContext = {
        user_id: session.userId,
        tenant_id: session.tenantId,
        ...(workspaceRoles[0]?.workspaceId
          ? { workspace_id: workspaceRoles[0].workspaceId }
          : {}),
        roles: [...tenantRoles, ...workspaceRoles].map((row) => row.role),
        permissions: [],
        session_id: session.id,
      };
    } catch {
      // RBAC guard returns standard denial for invalid or revoked sessions.
    }
    next();
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
