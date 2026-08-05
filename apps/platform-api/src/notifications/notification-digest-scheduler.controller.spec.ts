import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { NotificationDigestSchedulerController } from "./notification-digest-scheduler.controller";
import type { NotificationService } from "./notification.service";

const REAL_TOKEN = "real-shared-secret";
const TOKEN_HASH = createHash("sha256").update(REAL_TOKEN).digest("hex");

function setup() {
  const notifications = {
    runDueDigests: vi.fn(async () => ({ usersProcessed: 3, usersFailed: 0 })),
  } as unknown as NotificationService;
  const controller = new NotificationDigestSchedulerController(notifications, TOKEN_HASH);
  return { notifications, controller };
}

describe("NotificationDigestSchedulerController", () => {
  it("rejects a missing authorization header", async () => {
    const { controller } = setup();
    await expect(
      controller.runDueDigests(
        { period_start: "2026-08-05T00:00:00.000Z", period_end: "2026-08-06T00:00:00.000Z" },
        undefined,
      ),
    ).rejects.toThrow(HttpException);
  });

  it("rejects a wrong shared secret", async () => {
    const { controller } = setup();
    await expect(
      controller.runDueDigests(
        { period_start: "2026-08-05T00:00:00.000Z", period_end: "2026-08-06T00:00:00.000Z" },
        "Bearer wrong-token",
      ),
    ).rejects.toThrow(HttpException);
  });

  it("accepts the real shared secret and relays to NotificationService.runDueDigests", async () => {
    const { controller, notifications } = setup();
    const result = await controller.runDueDigests(
      { period_start: "2026-08-05T00:00:00.000Z", period_end: "2026-08-06T00:00:00.000Z" },
      `Bearer ${REAL_TOKEN}`,
    );
    expect(notifications.runDueDigests).toHaveBeenCalledWith(
      new Date("2026-08-05T00:00:00.000Z"),
      new Date("2026-08-06T00:00:00.000Z"),
    );
    expect(result).toEqual({ users_processed: 3, users_failed: 0 });
  });

  it("rejects an invalid period timestamp", async () => {
    const { controller } = setup();
    await expect(
      controller.runDueDigests(
        { period_start: "not-a-date", period_end: "2026-08-06T00:00:00.000Z" },
        `Bearer ${REAL_TOKEN}`,
      ),
    ).rejects.toThrow();
  });
});
