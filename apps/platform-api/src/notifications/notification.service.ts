import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { EmailProvider } from "@alterx/shared-clients";
import { NotificationHttpError } from "./problem";
import { NotificationRepository } from "./notification.repository";
import { EMAIL_PROVIDER } from "./tokens";
import type {
  CreateNotificationEventInput,
  DigestWindow,
  NotificationChannel,
  NotificationEvent,
  NotificationEventClass,
  NotificationListInput,
  NotificationPage,
  NotificationPreference,
} from "./types";

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly repository: NotificationRepository,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  async createEvent(input: CreateNotificationEventInput): Promise<NotificationEvent> {
    const [inAppEnabled, emailEnabled] = await Promise.all([
      this.repository.preferenceEnabled(input.tenantId, input.userId, input.eventClass, "in_app"),
      this.repository.preferenceEnabled(input.tenantId, input.userId, input.eventClass, "email"),
    ]);
    const event = await this.repository.createEvent(createEventId(), input, inAppEnabled);
    if (emailEnabled) await this.sendEventEmail(event, input.userId, input.locale);
    return event;
  }

  list(input: NotificationListInput): Promise<NotificationPage> {
    return this.repository.list(input);
  }

  async markRead(tenantId: string, userId: string, eventId: string): Promise<void> {
    if (!(await this.repository.markRead(tenantId, userId, eventId))) {
      throw notFound(`/api/v1/notifications/${encodeURIComponent(eventId)}/actions/read`);
    }
  }

  async acknowledge(tenantId: string, userId: string, eventId: string): Promise<void> {
    if (!(await this.repository.acknowledge(tenantId, userId, eventId))) {
      throw notFound(`/api/v1/notifications/${encodeURIComponent(eventId)}/actions/acknowledge`);
    }
  }

  listPreferences(tenantId: string, userId: string): Promise<NotificationPreference[]> {
    return this.repository.listPreferences(tenantId, userId);
  }

  updatePreference(
    tenantId: string,
    userId: string,
    eventClass: NotificationEventClass,
    channel: NotificationChannel,
    enabled: boolean,
  ): Promise<NotificationPreference> {
    return this.repository.upsertPreference(tenantId, userId, eventClass, channel, enabled);
  }

  async buildDigest(window: DigestWindow): Promise<{ readonly eventCount: number; readonly sent: boolean }> {
    if (window.periodStart >= window.periodEnd) {
      throw new Error("Digest period start must be before period end");
    }
    const preferences = await this.repository.listPreferences(window.tenantId, window.userId);
    const emailPreferences = new Map<NotificationEventClass, boolean>(
      preferences
        .filter((preference) => preference.channel === "email")
        .map((preference) => [preference.eventClass, preference.enabled]),
    );
    const candidates = (await this.repository.listDigestCandidates(window)).filter(
      (event) => emailPreferences.get(event.event_class) ?? true,
    );
    if (candidates.length === 0) return { eventCount: 0, sent: false };

    const digestId = await this.repository.reserveDigest(
      window,
      candidates.map((event) => event.id),
    );
    if (!digestId) return { eventCount: candidates.length, sent: false };

    try {
      await this.email.sendTemplatedEmail(
        candidates[0]!.email,
        "notification-digest",
        {
          period_start: window.periodStart.toISOString(),
          period_end: window.periodEnd.toISOString(),
          event_count: String(candidates.length),
          events: JSON.stringify(candidates.map(digestEvent)),
        },
      );
      await this.repository.markDigestSent(window.tenantId, digestId);
      return { eventCount: candidates.length, sent: true };
    } catch (error) {
      await this.repository.releaseDigest(window.tenantId, digestId);
      throw error;
    }
  }

  private async sendEventEmail(
    event: NotificationEvent,
    userId: string,
    locale: string | undefined,
  ): Promise<void> {
    const email = await this.repository.findUserEmail(event.tenantId, userId);
    if (!email) {
      this.logger.warn({ eventId: event.id, message: "notification recipient has no email" });
      return;
    }
    try {
      await this.email.sendTemplatedEmail(
        email,
        `notification-${event.eventClass}`,
        {
          title: event.title,
          body: event.body,
          severity: event.severity,
          deep_link: event.deepLink ?? "",
        },
        locale,
      );
    } catch {
      this.logger.error({ eventId: event.id, message: "notification email delivery failed" });
    }
  }
}

function createEventId(): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `evt_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function digestEvent(event: {
  readonly id: string;
  readonly event_class: string;
  readonly severity: string;
  readonly title: string;
  readonly body: string;
  readonly deep_link: string | null;
  readonly created_at: Date;
}): Record<string, string> {
  return {
    id: event.id,
    event_class: event.event_class,
    severity: event.severity,
    title: event.title,
    body: event.body,
    deep_link: event.deep_link ?? "",
    created_at: event.created_at.toISOString(),
  };
}

function notFound(instance: string): NotificationHttpError {
  return new NotificationHttpError(404, "NOTIFICATION_NOT_FOUND", "Notification was not found", instance);
}
