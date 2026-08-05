import { describe, expect, it, vi } from "vitest";
import { NotificationService } from "./notification.service";
import type { NotificationRepository } from "./notification.repository";
import type { SystemNotificationStore } from "./system-notification-store";
import type { NotificationDeliveryMode, NotificationEvent } from "./types";

const event: NotificationEvent = {
  id: "evt_01988654-0000-7000-8000-000000000001",
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  eventClass: "workflow",
  severity: "warning",
  title: "Workflow needs attention",
  body: "Step failed",
  deepLink: "/workflows/wf_1",
  sourceService: "orchestration-service",
  createdAt: "2026-08-05T00:00:00.000Z",
  readAt: null,
  acknowledgedAt: null,
};

function setup(
  preferences: Record<string, boolean> = {},
  emailDeliveryModes: Record<string, NotificationDeliveryMode> = {},
  systemStore?: SystemNotificationStore,
) {
  const repository = {
    preferenceEnabled: vi.fn(async (_tenant: string, _user: string, eventClass: string, channel: string) =>
      preferences[`${eventClass}:${channel}`] ?? true,
    ),
    emailDeliveryPreference: vi.fn(async (_tenant: string, _user: string, eventClass: string) => ({
      enabled: preferences[`${eventClass}:email`] ?? true,
      deliveryMode: emailDeliveryModes[eventClass] ?? "immediate",
    })),
    createEvent: vi.fn(async () => event),
    findUserEmail: vi.fn(async () => "user@example.com"),
    listPreferences: vi.fn(async () => []),
    listDigestCandidates: vi.fn(async () => []),
    reserveDigest: vi.fn(async () => undefined),
    markDigestSent: vi.fn(async () => undefined),
    releaseDigest: vi.fn(async () => undefined),
  } as unknown as NotificationRepository;
  const email = { sendTemplatedEmail: vi.fn(async () => ({ messageId: "mail-1", acceptedAt: event.createdAt })) };
  return {
    repository,
    email,
    service: new NotificationService(repository, email as never, systemStore),
  };
}

describe("NotificationService", () => {
  it("defaults both preference channels on and sends event email", async () => {
    const target = setup();
    await target.service.createEvent({
      tenantId: event.tenantId, workspaceId: event.workspaceId, userId: "user-a",
      eventClass: event.eventClass, severity: event.severity, title: event.title, body: event.body,
      deepLink: event.deepLink, sourceService: event.sourceService,
    });
    expect(target.repository.createEvent).toHaveBeenCalledWith(expect.stringMatching(/^evt_/), expect.anything(), true);
    expect(target.email.sendTemplatedEmail).toHaveBeenCalledWith(
      "user@example.com", "notification-workflow", expect.objectContaining({ title: event.title }), undefined,
    );
  });

  it("keeps in-app delivery on when email preference is explicitly off", async () => {
    const target = setup({ "workflow:email": false });
    await target.service.createEvent({
      tenantId: event.tenantId, workspaceId: event.workspaceId, userId: "user-a",
      eventClass: event.eventClass, severity: event.severity, title: event.title, body: event.body,
      deepLink: event.deepLink, sourceService: event.sourceService,
    });
    expect(target.repository.createEvent).toHaveBeenCalledWith(expect.any(String), expect.anything(), true);
    expect(target.email.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("stores email-only event when in-app preference is explicitly off", async () => {
    const target = setup({ "workflow:in_app": false });
    await target.service.createEvent({
      tenantId: event.tenantId, workspaceId: event.workspaceId, userId: "user-a",
      eventClass: event.eventClass, severity: event.severity, title: event.title, body: event.body,
      deepLink: event.deepLink, sourceService: event.sourceService,
    });
    expect(target.repository.createEvent).toHaveBeenCalledWith(expect.any(String), expect.anything(), false);
    expect(target.email.sendTemplatedEmail).toHaveBeenCalledTimes(1);
  });

  it("batches a half-open digest window once and marks it sent", async () => {
    const target = setup();
    (target.repository.listDigestCandidates as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: event.id, event_class: "workflow", severity: "warning", title: event.title, body: event.body, deep_link: event.deepLink, created_at: new Date(event.createdAt), email: "user@example.com" },
    ]);
    (target.repository.reserveDigest as ReturnType<typeof vi.fn>).mockResolvedValueOnce("digest-1");
    await expect(target.service.buildDigest({
      tenantId: event.tenantId, userId: "user-a", periodStart: new Date("2026-08-05T00:00:00.000Z"), periodEnd: new Date("2026-08-06T00:00:00.000Z"),
    })).resolves.toEqual({ eventCount: 1, sent: true });
    expect(target.email.sendTemplatedEmail).toHaveBeenCalledWith(
      "user@example.com", "notification-digest", expect.objectContaining({ event_count: "1" }),
    );
    expect(target.repository.markDigestSent).toHaveBeenCalledWith(event.tenantId, "digest-1");
  });

  it("does not immediately email an event whose email preference is delivery_mode=digest", async () => {
    const target = setup({}, { workflow: "digest" });
    await target.service.createEvent({
      tenantId: event.tenantId, workspaceId: event.workspaceId, userId: "user-a",
      eventClass: event.eventClass, severity: event.severity, title: event.title, body: event.body,
      deepLink: event.deepLink, sourceService: event.sourceService,
    });
    expect(target.email.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("still immediately emails when delivery_mode is the default immediate", async () => {
    const target = setup({}, { workflow: "immediate" });
    await target.service.createEvent({
      tenantId: event.tenantId, workspaceId: event.workspaceId, userId: "user-a",
      eventClass: event.eventClass, severity: event.severity, title: event.title, body: event.body,
      deepLink: event.deepLink, sourceService: event.sourceService,
    });
    expect(target.email.sendTemplatedEmail).toHaveBeenCalledTimes(1);
  });

  it("runDueDigests processes every real eligible user via buildDigest, isolating failures", async () => {
    const systemStore = {
      listUsersDueForDigest: vi.fn(async () => [
        { tenantId: "tenant-a", userId: "user-a" },
        { tenantId: "tenant-b", userId: "user-b" },
      ]),
    } as unknown as SystemNotificationStore;
    const target = setup({}, {}, systemStore);
    (target.repository.listDigestCandidates as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("db down"));

    const result = await target.service.runDueDigests(
      new Date("2026-08-05T00:00:00.000Z"),
      new Date("2026-08-06T00:00:00.000Z"),
    );

    expect(result).toEqual({ usersProcessed: 2, usersFailed: 1 });
  });

  it("runDueDigests throws a real, disclosed error when no system store is configured", async () => {
    const target = setup();
    await expect(
      target.service.runDueDigests(new Date(), new Date()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        status: 503,
        detail: expect.stringContaining("not configured"),
      }),
    });
  });
});
