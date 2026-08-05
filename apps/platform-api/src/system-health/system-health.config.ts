export const systemHealthServiceNames = [
  "ads-core",
  "audit-service",
  "background-workers",
  "cost-ledger-service",
  "eval-service",
  "intelligence-service",
  "memory-service",
  "model-gateway",
  "orchestration-service",
  "provisioning-service",
  "sandbox-service",
  "tool-gateway",
  "verification-service",
] as const;

export type SystemServiceName = (typeof systemHealthServiceNames)[number];

export interface SystemHealthTarget {
  readonly name: SystemServiceName;
  readonly baseUrl?: string;
}

export interface SystemHealthConfig {
  readonly targets: readonly SystemHealthTarget[];
  readonly timeoutMs: number;
}

const defaultTimeoutMs = 2_500;

export function systemHealthConfigFromEnvironment(
  environment: NodeJS.ProcessEnv,
): SystemHealthConfig {
  const timeoutMs = parseTimeout(environment.SYSTEM_HEALTH_TIMEOUT_MS);
  const endpointMap = parseEndpointMap(environment.SYSTEM_HEALTH_ENDPOINTS_JSON);

  return {
    timeoutMs,
    targets: systemHealthServiceNames.map((name) => {
      const baseUrl = endpointMap?.[name];
      return baseUrl === undefined ? { name } : { name, baseUrl };
    }),
  };
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return defaultTimeoutMs;
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error("SYSTEM_HEALTH_TIMEOUT_MS must be a positive integer");
  }
  return Number(value);
}

function parseEndpointMap(
  value: string | undefined,
): Readonly<Record<SystemServiceName, string>> | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("SYSTEM_HEALTH_ENDPOINTS_JSON must be a JSON object");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SYSTEM_HEALTH_ENDPOINTS_JSON must be a JSON object");
  }

  const endpointMap = parsed as Record<string, unknown>;
  for (const name of Object.keys(endpointMap)) {
    if (!systemHealthServiceNames.includes(name as SystemServiceName)) {
      throw new Error(`SYSTEM_HEALTH_ENDPOINTS_JSON has unknown service ${name}`);
    }
  }

  const configured: Partial<Record<SystemServiceName, string>> = {};
  for (const name of systemHealthServiceNames) {
    const endpoint = endpointMap[name];
    if (typeof endpoint !== "string" || endpoint.length === 0) {
      throw new Error(`SYSTEM_HEALTH_ENDPOINTS_JSON missing ${name}`);
    }
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      configured[name] = url.toString().replace(/\/+$/, "");
    } catch {
      throw new Error(`SYSTEM_HEALTH_ENDPOINTS_JSON has invalid URL for ${name}`);
    }
  }

  return configured as Readonly<Record<SystemServiceName, string>>;
}
