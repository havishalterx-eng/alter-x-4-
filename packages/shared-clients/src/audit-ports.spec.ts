import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import {
  AUDIT_GENESIS_HASH_HEX,
  calculateAuditEntryHash,
  verifyAuditChain,
  type AuditEventToAppend,
} from "./audit-ports";
import { createMockAuditStoreProvider } from "./mocks/audit-store-provider";

function event(actorRef: string): AuditEventToAppend {
  return {
    id: randomUUID(),
    tenantId: null,
    tenantPseudonym: null,
    actorType: "system",
    actorRef,
    action: "system.test",
    targetType: null,
    targetRef: null,
    result: "success",
    reasonCode: null,
    context: { request_id: actorRef },
    occurredAt: new Date("2026-07-24T06:30:00.000Z"),
  };
}

describe("AuditStoreProvider mock", () => {
  it("serializes concurrent appends into a verifiable global chain", async () => {
    const provider = createMockAuditStoreProvider();
    const stored = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        provider.append(event(`system-${index}`)),
      ),
    );

    expect(stored[0]?.prevHash.toString("hex")).toBe(
      AUDIT_GENESIS_HASH_HEX,
    );
    expect(calculateAuditEntryHash(stored[0]!)).toEqual(stored[0]?.entryHash);
    expect(verifyAuditChain(await provider.readGlobalChain())).toEqual({
      valid: true,
      checkedEvents: 8,
    });
    expect(provider.snapshot()).toHaveLength(8);
  });

  it("returns defensive copies and supports lifecycle methods", async () => {
    const provider = createMockAuditStoreProvider();
    const stored = await provider.append(event("system-copy"));
    stored.prevHash.fill(1);

    expect(provider.snapshot()[0]?.prevHash.toString("hex")).toBe(
      AUDIT_GENESIS_HASH_HEX,
    );
    await expect(provider.migrate()).resolves.toBeUndefined();
    await expect(provider.close()).resolves.toBeUndefined();
  });
});
