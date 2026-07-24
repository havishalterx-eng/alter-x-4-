import { z } from "zod";

export const platformApiEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  // Reserved for platform cache wiring in a later ticket.
  REDIS_ENDPOINT_PARAM: z.string().optional(),
  // Production DB wiring resolves through SecretsProvider in a later ticket.
  DATABASE_SECRET_REF: z.string().optional(),
});

export type PlatformApiEnv = z.infer<typeof platformApiEnvSchema>;

export function validatePlatformApiEnv(env: NodeJS.ProcessEnv): PlatformApiEnv {
  const parsed = platformApiEnvSchema.safeParse(env);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid platform-api environment: ${formatted}`);
  }

  return parsed.data;
}
