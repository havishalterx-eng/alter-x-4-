import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { StaffRepository } from "./staff.repository";

@Injectable()
export class StaffService {
  constructor(private readonly repository: StaffRepository) {}

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
    staffUserId: string,
    tenantId: string,
    reasonCode: string,
    reasonText: string,
    durationMinutes: number,
  ) {
    return this.repository.grant(
      `jit_${randomUUID()}`,
      staffUserId,
      tenantId,
      reasonCode,
      reasonText,
      new Date(Date.now() + durationMinutes * 60_000),
    );
  }

  revoke(grantId: string, staffUserId: string) {
    return this.repository.revoke(grantId, staffUserId);
  }

  active(staffUserId: string, tenantId: string) {
    return this.repository.active(staffUserId, tenantId);
  }

  list(staffUserId: string, includeAll: boolean) {
    return this.repository.list(staffUserId, includeAll);
  }

  listForTenant(tenantId: string, input: { readonly cursor?: string | undefined; readonly limit: number }) {
    return this.repository.listForTenant(tenantId, input);
  }
}
