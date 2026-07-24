import { z } from "zod";

const engineConfigSchema = z.object({
  ENGINE_BASE_URL: z.string().url(),
  ENGINE_M2M_TOKEN_URL: z.string().url(),
  ENGINE_M2M_AUDIENCE: z.string().min(1),
  ENGINE_M2M_CLIENT_ID: z.string().min(1),
  ENGINE_M2M_CLIENT_SECRET_REF: z.string().min(1),
  ENGINE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
});

export interface EngineConfig {
  baseUrl: string;
  m2mTokenUrl: string;
  m2mAudience: string;
  m2mClientId: string;
  m2mClientSecretRef: string;
  requestTimeoutMs: number;
}

export function engineConfigFromEnvironment(
  environment: NodeJS.ProcessEnv,
): EngineConfig {
  const parsed = engineConfigSchema.safeParse(environment);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid Engine client environment: ${detail}`);
  }

  return {
    baseUrl: parsed.data.ENGINE_BASE_URL.replace(/\/+$/, ""),
    m2mTokenUrl: parsed.data.ENGINE_M2M_TOKEN_URL,
    m2mAudience: parsed.data.ENGINE_M2M_AUDIENCE,
    m2mClientId: parsed.data.ENGINE_M2M_CLIENT_ID,
    m2mClientSecretRef: parsed.data.ENGINE_M2M_CLIENT_SECRET_REF,
    requestTimeoutMs: parsed.data.ENGINE_REQUEST_TIMEOUT_MS,
  };
}
