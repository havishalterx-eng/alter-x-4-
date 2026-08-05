import { z } from "zod";

const engineConfigSchema = z.object({
  ENGINE_BASE_URL: z.string().url(),
  ADS_CORE_BASE_URL: z.string().url(),
  COST_LEDGER_BASE_URL: z.string().url(),
  AUDIT_SERVICE_BASE_URL: z.string().url(),
  AUDIT_QUERY_SERVICE_TOKEN_REF: z.string().min(1),
  EVAL_SERVICE_GRPC_TARGET: z.string().min(1),
  ENGINE_M2M_TOKEN_URL: z.string().url(),
  ENGINE_M2M_AUDIENCE: z.string().min(1),
  ENGINE_M2M_CLIENT_ID: z.string().min(1),
  ENGINE_M2M_CLIENT_SECRET_REF: z.string().min(1),
  ENGINE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
});

export interface EngineConfig {
  baseUrl: string;
  adsCoreBaseUrl: string;
  costLedgerBaseUrl: string;
  auditServiceBaseUrl: string;
  auditQueryServiceTokenRef: string;
  evalServiceGrpcTarget: string;
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
    adsCoreBaseUrl: parsed.data.ADS_CORE_BASE_URL.replace(/\/+$/, ""),
    costLedgerBaseUrl: parsed.data.COST_LEDGER_BASE_URL.replace(/\/+$/, ""),
    auditServiceBaseUrl: parsed.data.AUDIT_SERVICE_BASE_URL.replace(/\/+$/, ""),
    auditQueryServiceTokenRef: parsed.data.AUDIT_QUERY_SERVICE_TOKEN_REF,
    evalServiceGrpcTarget: parsed.data.EVAL_SERVICE_GRPC_TARGET,
    m2mTokenUrl: parsed.data.ENGINE_M2M_TOKEN_URL,
    m2mAudience: parsed.data.ENGINE_M2M_AUDIENCE,
    m2mClientId: parsed.data.ENGINE_M2M_CLIENT_ID,
    m2mClientSecretRef: parsed.data.ENGINE_M2M_CLIENT_SECRET_REF,
    requestTimeoutMs: parsed.data.ENGINE_REQUEST_TIMEOUT_MS,
  };
}
