import { describe, expect, it, vi } from "vitest";

import { createPlatformJobHandlers } from "./handlers";

describe("createPlatformJobHandlers", () => {
  it("registers the real health-ping handler", async () => {
    const handlers = createPlatformJobHandlers();
    const handler = handlers.get("platform.health-ping");
    expect(handler).toBeDefined();

    const result = await handler!({ probe: 1 });
    expect(result).toEqual({ pong: true, receivedPayload: { probe: 1 } });
  });

  it("has no handler registered for an unknown job type", () => {
    const handlers = createPlatformJobHandlers();
    expect(handlers.get("platform.does-not-exist")).toBeUndefined();
  });

  it("does not register the notification-digest handler without real dependencies", () => {
    const handlers = createPlatformJobHandlers();
    expect(handlers.get("platform.notification-digest")).toBeUndefined();
  });

  it("registers a real notification-digest handler that relays to platform-api's internal route", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ users_processed: 2, users_failed: 0 }),
      text: async () => "",
    })) as unknown as typeof fetch;

    const handlers = createPlatformJobHandlers({
      platformApiInternalBaseUrl: "http://platform-api.internal",
      notificationDigestServiceToken: "real-token",
      fetchImpl,
    });
    const handler = handlers.get("platform.notification-digest");
    expect(handler).toBeDefined();

    const result = await handler!({
      period_start: "2026-08-05T00:00:00.000Z",
      period_end: "2026-08-06T00:00:00.000Z",
    } as never);

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://platform-api.internal/internal/notifications/run-due-digests",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer real-token" }),
      }),
    );
    expect(result).toEqual({ users_processed: 2, users_failed: 0 });
  });

  it("throws a real error when the internal route responds non-2xx", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "service unavailable",
    })) as unknown as typeof fetch;

    const handlers = createPlatformJobHandlers({
      platformApiInternalBaseUrl: "http://platform-api.internal",
      notificationDigestServiceToken: "real-token",
      fetchImpl,
    });
    const handler = handlers.get("platform.notification-digest")!;

    await expect(
      handler({
        period_start: "2026-08-05T00:00:00.000Z",
        period_end: "2026-08-06T00:00:00.000Z",
      } as never),
    ).rejects.toThrow(/503/);
  });
});
