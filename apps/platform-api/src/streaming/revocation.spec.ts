import { describe, expect, it, vi } from "vitest";
import {
  revocationMatches,
  StreamRevocationBus,
} from "./revocation";

describe("StreamRevocationBus", () => {
  it("publishes revocation signals and supports unsubscribe", () => {
    const bus = new StreamRevocationBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);
    bus.publish({ tenantId: "tenant-a", sessionId: "session-a" });
    unsubscribe();
    bus.publish({ tenantId: "tenant-a" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("matches tenant, user, and session scope without cross-tenant closure", () => {
    const actor = {
      tenantId: "tenant-a",
      userId: "user-a",
      sessionId: "session-a",
    };
    expect(revocationMatches({ tenantId: "tenant-a" }, actor)).toBe(true);
    expect(
      revocationMatches(
        { tenantId: "tenant-a", userId: "user-a", sessionId: "session-a" },
        actor,
      ),
    ).toBe(true);
    expect(
      revocationMatches({ tenantId: "tenant-b", sessionId: "session-a" }, actor),
    ).toBe(false);
    expect(
      revocationMatches({ tenantId: "tenant-a", userId: "user-b" }, actor),
    ).toBe(false);
    expect(
      revocationMatches({ tenantId: "tenant-a", sessionId: "session-b" }, actor),
    ).toBe(false);
  });
});
