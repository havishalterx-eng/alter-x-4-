import { randomUUID } from "node:crypto";
import { ForbiddenException, Injectable } from "@nestjs/common";
import type { StaffAccessScope } from "@alterx/contracts";
import { AdminAuditService } from "../admin-audit";
import { StaffRepository } from "./staff.repository";

@Injectable()
export class StaffService {
  constructor(
    private readonly repository: StaffRepository,
    private readonly audit: AdminAuditService,
  ) {}

  async resolve(accessToken: string) {
    const domain = process.env.AUTH0_STAFF_DOMAIN;
    if (!domain) {
      return undefined;
    }

    // This is the dedicated staff Auth0 tenant, never an Engine API request.
    const response = await globalThis.fetch(`https://${domain}/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      return undefined;
    }

    const profile = (await response.json()) as { sub?: string; email?: string };
    if (!profile.sub || !profile.email) {
      return undefined;
    }
    return this.repository.find(profile.sub);
  }

  grant(
    grantedByStaffUserId: string,
    staffUserId: string,
    tenantId: string,
    reasonCode: string,
    reasonText: string,
    durationMinutes: number,
    scopes: readonly StaffAccessScope[] = ["tenant:read"],
  ) {
    return this.grantAndAudit(
      `jit_${randomUUID()}`,
      staffUserId,
      tenantId,
      reasonCode,
      reasonText,
      new Date(Date.now() + durationMinutes * 60_000),
      scopes,
      grantedByStaffUserId,
    );
  }

  private async grantAndAudit(
    id: string,
    staffUserId: string,
    tenantId: string,
    reasonCode: string,
    reasonText: string,
    expiresAt: Date,
    scopes: readonly StaffAccessScope[],
    grantedByStaffUserId: string,
  ) {
    const grant = await this.repository.grant(
      id,
      staffUserId,
      tenantId,
      reasonCode,
      reasonText,
      expiresAt,
      scopes,
      grantedByStaffUserId,
    );
    await this.audit.record({
      tenantId,
      actorType: "support",
      actorRef: grantedByStaffUserId,
      action: "support.access.granted",
      targetType: "jit_grant",
      targetRef: grant.id,
      reasonCode,
      scope: scopes,
    });
    return grant;
  }

  async revoke(grantId: string, staffUserId: string) {
    const grant = await this.repository.revoke(grantId, staffUserId);
    if (grant) {
      await this.audit.record({
        tenantId: grant.tenant_id,
        actorType: "support",
        actorRef: staffUserId,
        action: "support.access.revoked",
        targetType: "jit_grant",
        targetRef: grant.id,
        reasonCode: grant.reason_code,
        scope: grant.scopes,
      });
    }
    return grant;
  }

  active(staffUserId: string, tenantId: string) {
    return this.repository.active(staffUserId, tenantId);
  }

  async requireAccess(
    grantId: string,
    staffUserId: string,
    tenantId: string,
    scope: StaffAccessScope,
  ) {
    const result = await this.repository.authorize(
      grantId,
      staffUserId,
      tenantId,
      scope,
    );
    if (result.grant && result.status === "expired") {
      await this.audit.record({
        tenantId,
        actorType: "support",
        actorRef: staffUserId,
        action: "support.access.expired",
        targetType: "jit_grant",
        targetRef: grantId,
        reasonCode: result.grant.reason_code,
        scope,
      });
    }
    if (!result.grant || result.status !== "active") {
      throw new ForbiddenException("Active scoped support grant required");
    }
    await this.audit.record({
      tenantId,
      actorType: "support",
      actorRef: staffUserId,
      action: "support.access.used",
      targetType: "jit_grant",
      targetRef: grantId,
      reasonCode: result.grant.reason_code,
      scope,
    });
    return result.grant;
  }

  list(staffUserId: string, includeAll: boolean) {
    return this.repository.list(staffUserId, includeAll);
  }

  listForTenant(tenantId: string, input: { readonly cursor?: string | undefined; readonly limit: number }) {
    return this.repository.listForTenant(tenantId, input);
  }
}
