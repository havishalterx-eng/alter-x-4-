import { z } from "zod";

export const platformApiEnvSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    // Reserved for platform cache wiring in a later ticket.
    REDIS_ENDPOINT_PARAM: z.string().optional(),
    // Production DB wiring resolves through SecretsProvider in a later ticket.
    DATABASE_SECRET_REF: z.string().optional(),
    IDENTITY_PROVIDER: z.enum(["auth0", "mock"]).default("mock"),
    AUTH0_DOMAIN: z.string().min(1).optional(),
    AUTH0_CLIENT_ID: z.string().min(1).optional(),
    AUTH0_CLIENT_SECRET_REF: z.string().min(1).optional(),
    AUTH0_M2M_CLIENT_ID: z.string().min(1).optional(),
    AUTH0_M2M_CLIENT_SECRET_REF: z.string().min(1).optional(),
    SESSION_COOKIE_SIGNING_KEY_REF: z.string().min(1).optional(),
    SIGNING_KEY_PROVIDER: z.enum(["secrets", "mock"]).default("secrets"),
    ACTOR_TOKEN_SIGNING_KEY_REF: z.string().min(1).optional(),
    ALTER_CONFIG_SOURCE: z.enum(["appconfig", "local-file"]).default("local-file"),
    APPCONFIG_APP_ID: z.string().min(1).optional(),
    APPCONFIG_ENV_ID: z.string().min(1).optional(),
    APPCONFIG_PROFILE_ID: z.string().min(1).optional(),
    ENGINE_BASE_URL: z.string().url().optional(),
    ENGINE_M2M_TOKEN_URL: z.string().url().optional(),
    ENGINE_M2M_AUDIENCE: z.string().min(1).optional(),
    ENGINE_M2M_CLIENT_ID: z.string().min(1).optional(),
    ENGINE_M2M_CLIENT_SECRET_REF: z.string().min(1).optional(),
    ENGINE_REQUEST_TIMEOUT_MS: z.string().regex(/^[1-9]\d*$/).optional(),
    IDEMPOTENCY_TTL_SECONDS: z.string().regex(/^[1-9]\d*$/).optional(),
    RAZORPAY_KEY_ID_SECRET_REF: z.string().min(1).optional(),
    RAZORPAY_KEY_SECRET_SECRET_REF: z.string().min(1).optional(),
    RAZORPAY_WEBHOOK_SECRET_REF: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),
  })
  .superRefine((env, context) => {
    if (env.SIGNING_KEY_PROVIDER === "secrets" && !env.ACTOR_TOKEN_SIGNING_KEY_REF) {
      context.addIssue({
        code: "custom",
        path: ["ACTOR_TOKEN_SIGNING_KEY_REF"],
        message: "ACTOR_TOKEN_SIGNING_KEY_REF required when SIGNING_KEY_PROVIDER=secrets",
      });
    }

    if (env.IDENTITY_PROVIDER === "auth0") {
      requireFields(
        env,
        context,
        [
          "AUTH0_DOMAIN",
          "AUTH0_CLIENT_ID",
          "AUTH0_CLIENT_SECRET_REF",
          "AUTH0_M2M_CLIENT_ID",
          "AUTH0_M2M_CLIENT_SECRET_REF",
          "SESSION_COOKIE_SIGNING_KEY_REF",
        ],
        "IDENTITY_PROVIDER=auth0",
      );
    }

    if (env.ALTER_CONFIG_SOURCE === "appconfig") {
      requireFields(
        env,
        context,
        ["APPCONFIG_APP_ID", "APPCONFIG_ENV_ID", "APPCONFIG_PROFILE_ID"],
        "ALTER_CONFIG_SOURCE=appconfig",
      );
    }
  });

function requireFields<
  T extends Record<string, unknown>,
  K extends Extract<keyof T, string>,
>(env: T, context: z.RefinementCtx<T>, fields: readonly K[], condition: string): void {
  for (const field of fields) {
    if (!env[field]) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} required when ${condition}`,
        input: env,
      });
    }
  }
}

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
