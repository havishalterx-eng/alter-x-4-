import { z } from "zod";
import { NotificationHttpError } from "./problem";
import {
  notificationChannels,
  notificationEventClasses,
  notificationSeverities,
  type NotificationListInput,
  type NotificationPreference,
} from "./types";

const preferenceSchema = z.object({
  event_class: z.enum(notificationEventClasses),
  channel: z.enum(notificationChannels),
  enabled: z.boolean(),
});

const preferencesSchema = z.object({
  preferences: z.array(preferenceSchema).min(1).max(12),
});

const listSchema = z.object({
  read: z.enum(["true", "false"]).optional(),
  severity: z.enum(notificationSeverities).optional(),
  event_class: z.enum(notificationEventClasses).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});

export function parseListInput(
  tenantId: string,
  userId: string,
  value: unknown,
): NotificationListInput {
  const parsed = parse(listSchema, value, "/api/v1/notifications");
  return {
    tenantId,
    userId,
    read: parsed.read === undefined ? undefined : parsed.read === "true",
    severity: parsed.severity,
    eventClass: parsed.event_class,
    limit: parsed.limit,
    cursor: parsed.cursor,
  };
}

export function parsePreferences(value: unknown): NotificationPreference[] {
  return parse(preferencesSchema, value, "/api/v1/notifications/preferences").preferences.map(
    (preference) => ({
      eventClass: preference.event_class,
      channel: preference.channel,
      enabled: preference.enabled,
    }),
  );
}

export function parseNotificationId(value: string, instance: string): string {
  if (!/^evt_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new NotificationHttpError(400, "NOTIFICATION_ID_INVALID", "Notification ID is invalid", instance);
  }
  return value;
}

function parse<T extends z.ZodType>(schema: T, value: unknown, instance: string): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new NotificationHttpError(400, "NOTIFICATION_INPUT_INVALID", "Notification input is invalid", instance);
}
