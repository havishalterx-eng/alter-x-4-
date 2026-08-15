import type { ProviderCapabilities } from "@alterx/contracts";
import { createMockProvider } from "../mock-provider";
import type {
  CronScheduleManager,
  CronScheduleUpsertRequest,
  ProviderMetadata,
} from "../provider-types";
import { mockCapabilities, mockMetadata } from "./shared";

export const MOCK_CRON_SCHEDULE_MANAGER_CAPABILITIES: ProviderCapabilities =
  mockCapabilities(262_144);

export interface MockCronScheduleManager extends CronScheduleManager {
  listSchedules(): readonly CronScheduleUpsertRequest[];
  deletedScheduleIds(): readonly string[];
}

export interface MockCronScheduleManagerOptions {
  readonly providerId?: string;
  readonly metadata?: ProviderMetadata<"CronScheduleManager">;
  readonly capabilities?: ProviderCapabilities;
}

export function createMockCronScheduleManager(
  options: MockCronScheduleManagerOptions = {},
): MockCronScheduleManager {
  const providerId = options.providerId ?? "mock.cron-schedule-manager";
  const schedules = new Map<string, CronScheduleUpsertRequest>();
  const deleted: string[] = [];

  return createMockProvider<MockCronScheduleManager>({
    metadata:
      options.metadata ?? mockMetadata(providerId, "CronScheduleManager"),
    capabilities:
      options.capabilities ?? MOCK_CRON_SCHEDULE_MANAGER_CAPABILITIES,
    implementation: {
      upsertCronSchedule: async (request) => {
        schedules.set(request.scheduleId, { ...request });
      },
      deleteCronSchedule: async (scheduleId) => {
        schedules.delete(scheduleId);
        deleted.push(scheduleId);
      },
      listSchedules: () => Object.freeze([...schedules.values()]),
      deletedScheduleIds: () => Object.freeze([...deleted]),
    },
  });
}