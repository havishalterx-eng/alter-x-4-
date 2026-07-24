import { z } from "zod";

export const TriggerConfigSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cron"),
    cron_expression: z.string(),
    timezone: z.string(),
  }),
  z.object({
    kind: z.literal("webhook"),
    provider: z.string(),
    dedup_window_seconds: z.number().int(),
  }),
]);
export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;
