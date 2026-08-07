import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditEventsClient } from "../engine";
import { AdminAuditService } from "./admin-audit.service";

describe("AdminAuditService", () => {
  afterEach(() => vi.useRealTimers());

  it("records a hash-chained admin event with bounded context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T10:00:00.000Z"));
    const record = vi.fn().mockResolvedValue({
      id: "aud_event",
      entry_hash: "a".repeat(64),
    });
    const service = new AdminAuditService(
      { record } as unknown as AuditEventsClient,
    );

    await expect(service.record({
      tenantId: "f0204070-2fd2-4bb7-a117-3222301822fe",
      actorType: "admin",
      actorRef: "stf_ops",
      action: "tenant.suspend",
      targetType: "tenant",
      targetRef: "f0204070-2fd2-4bb7-a117-3222301822fe",
      reasonCode: "policy_violation",
      scope: "tenant:write",
    })).resolves.toBe("a".repeat(64));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: "f0204070-2fd2-4bb7-a117-3222301822fe",
      context_json: '{"scope":"tenant:write"}',
      occurred_at: "2026-08-06T10:00:00.000Z",
    }));
  });
});
