import { createMockAuditStoreProvider, type AuditStoreProvider } from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";

import { AuditService } from "./audit.service";
import { auditId } from "./audit-id";

const TENANT_A = "018f47a2-7b11-7b11-8a11-1234567890ab";
const TENANT_B = "028f47a2-7b11-7b11-8a11-1234567890ab";

async function seededService(): Promise<{
  readonly service: AuditService;
  readonly store: AuditStoreProvider;
}> {
  const store = createMockAuditStoreProvider();
  const service = new AuditService(store);
  const base = {
    tenantPseudonym: null,
    actorRef: "actor-1",
    targetType: null,
    targetRef: null,
    reasonCode: null,
    context: null,
  };
  await store.append({ ...base, id: "aaaaaaaa-0000-7000-8000-000000000001", tenantId: TENANT_A, actorType: "user", action: "workflow.create", result: "success", occurredAt: new Date("2026-08-01T00:00:00.000Z") });
  await store.append({ ...base, id: "aaaaaaaa-0000-7000-8000-000000000002", tenantId: TENANT_A, actorType: "support", action: "support.access.grant", result: "success", reasonCode: "ticket-1", occurredAt: new Date("2026-08-01T00:01:00.000Z") });
  await store.append({ ...base, id: "aaaaaaaa-0000-7000-8000-000000000003", tenantId: TENANT_A, actorType: "admin", action: "policy.promote", result: "success", occurredAt: new Date("2026-08-01T00:02:00.000Z") });
  await store.append({ ...base, id: "aaaaaaaa-0000-7000-8000-000000000004", tenantId: TENANT_B, actorType: "user", action: "workflow.create", result: "success", occurredAt: new Date("2026-08-01T00:03:00.000Z") });
  return { service, store };
}

describe("AuditService.queryEvents", () => {
  it("scopes to the requested tenant only", async () => {
    const { service } = await seededService();
    const result = await service.queryEvents({
      tenantId: `ten_${TENANT_A}`,
      actorTypes: [],
      action: "",
      result: "",
      occurredAfter: "",
      occurredBefore: "",
      cursor: "",
      limit: 50,
    });
    // tenant_id isn't in the response shape; scoping is proven by the count
    // (3, not the full 4 seeded across both tenants).
    expect(result.events).toHaveLength(3);
    expect(result.events.some((event) => event.action === "workflow.create")).toBe(true);
  });

  it("performs a genuinely cross-tenant query when tenantId is empty", async () => {
    const { service } = await seededService();
    const result = await service.queryEvents({
      tenantId: "",
      actorTypes: [],
      action: "",
      result: "",
      occurredAfter: "",
      occurredBefore: "",
      cursor: "",
      limit: 50,
    });
    expect(result.events).toHaveLength(4);
  });

  it("filters by actor_types", async () => {
    const { service } = await seededService();
    const result = await service.queryEvents({
      tenantId: `ten_${TENANT_A}`,
      actorTypes: ["user", "support"],
      action: "",
      result: "",
      occurredAfter: "",
      occurredBefore: "",
      cursor: "",
      limit: 50,
    });
    expect(result.events).toHaveLength(2);
    expect(result.events.map((event) => event.action).sort()).toEqual(["support.access.grant", "workflow.create"]);
  });

  it("rejects an unsupported actor_type rather than silently dropping it", async () => {
    const { service } = await seededService();
    await expect(
      service.queryEvents({
        tenantId: `ten_${TENANT_A}`,
        actorTypes: ["not-a-real-actor-type"],
        action: "",
        result: "",
        occurredAfter: "",
        occurredBefore: "",
        cursor: "",
        limit: 50,
      }),
    ).rejects.toThrow(/unsupported/);
  });

  it("paginates via cursor without skipping or repeating rows", async () => {
    const { service } = await seededService();
    const page1 = await service.queryEvents({
      tenantId: "",
      actorTypes: [],
      action: "",
      result: "",
      occurredAfter: "",
      occurredBefore: "",
      cursor: "",
      limit: 2,
    });
    expect(page1.events).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();

    const page2 = await service.queryEvents({
      tenantId: "",
      actorTypes: [],
      action: "",
      result: "",
      occurredAfter: "",
      occurredBefore: "",
      cursor: page1.next_cursor?.replace(/^aud_/, "") ?? "",
      limit: 2,
    });
    expect(page2.events).toHaveLength(2);
    expect(page2.next_cursor).toBeNull();

    const allIds = [...page1.events, ...page2.events].map((event) => event.id);
    expect(new Set(allIds).size).toBe(4);
  });

  it("returns aud_-prefixed ids on events and next_cursor", async () => {
    const { service } = await seededService();
    const result = await service.queryEvents({
      tenantId: `ten_${TENANT_A}`,
      actorTypes: [],
      action: "",
      result: "",
      occurredAfter: "",
      occurredBefore: "",
      cursor: "",
      limit: 1,
    });
    expect(result.events[0]?.id).toBe(auditId("aaaaaaaa-0000-7000-8000-000000000001"));
    // next_cursor is the returned page's own last-item id (keyset pagination
    // semantics: the next query resumes strictly after this row).
    expect(result.next_cursor).toBe(auditId("aaaaaaaa-0000-7000-8000-000000000001"));
  });
});
