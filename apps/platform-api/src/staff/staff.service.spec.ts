import { describe, expect, it, vi } from "vitest";
import { AdminAuditService } from "../admin-audit";
import { StaffRepository, type JitGrant } from "./staff.repository";
import { StaffService } from "./staff.service";

const grant: JitGrant = {
  id: "jit_grant",
  staff_user_id: "stf_support",
  tenant_id: "f0204070-2fd2-4bb7-a117-3222301822fe",
  granted_at: new Date("2026-08-06T10:00:00.000Z"),
  expires_at: new Date("2026-08-06T11:00:00.000Z"),
  revoked_at: null,
  reason_code: "support_case",
  reason_text: "Investigate failed run",
  scopes: ["runs:read", "tenant:read"],
};

describe("StaffService scoped JIT access", () => {
  it("grants a named support user and records the grant in the hash chain", async () => {
    const repository = {
      grant: vi.fn().mockResolvedValue(grant),
    } as unknown as StaffRepository;
    const audit = { record: vi.fn().mockResolvedValue("a".repeat(64)) };
    const service = new StaffService(repository, audit as unknown as AdminAuditService);

    await service.grant(
      "stf_admin",
      "stf_support",
      grant.tenant_id,
      grant.reason_code,
      grant.reason_text,
      30,
      grant.scopes,
    );

    expect(repository.grant).toHaveBeenCalledWith(
      expect.stringMatching(/^jit_/),
      "stf_support",
      grant.tenant_id,
      grant.reason_code,
      grant.reason_text,
      expect.any(Date),
      grant.scopes,
      "stf_admin",
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorRef: "stf_admin",
      action: "support.access.granted",
      scope: grant.scopes,
    }));
  });

  it("denies expired access after recording expiry", async () => {
    const repository = {
      authorize: vi.fn().mockResolvedValue({ status: "expired", grant }),
    } as unknown as StaffRepository;
    const audit = { record: vi.fn().mockResolvedValue("b".repeat(64)) };
    const service = new StaffService(repository, audit as unknown as AdminAuditService);

    await expect(service.requireAccess(
      grant.id,
      grant.staff_user_id,
      grant.tenant_id,
      "tenant:read",
    )).rejects.toMatchObject({ status: 403 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "support.access.expired",
    }));
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({
      action: "support.access.used",
    }));
  });

  it("records use only after repository authorization succeeds", async () => {
    const repository = {
      authorize: vi.fn().mockResolvedValue({ status: "active", grant }),
    } as unknown as StaffRepository;
    const audit = { record: vi.fn().mockResolvedValue("c".repeat(64)) };
    const service = new StaffService(repository, audit as unknown as AdminAuditService);

    await expect(service.requireAccess(
      grant.id,
      grant.staff_user_id,
      grant.tenant_id,
      "tenant:read",
    )).resolves.toEqual(grant);
    expect(repository.authorize).toHaveBeenCalledWith(
      grant.id,
      grant.staff_user_id,
      grant.tenant_id,
      "tenant:read",
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "support.access.used",
    }));
  });
});
