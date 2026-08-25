import { createEnvironmentValidators } from "@alterx/adapters";

// Config for the Blackboard's gRPC transport (EXEC-7) only. Reuses
// REDIS_ENDPOINT/ORCHESTRATION_DATABASE_* from Session Gateway's config
// for the store/cache themselves -- only the gRPC bind address is
// specific to this ticket. Same "own file" reasoning as every other
// per-ticket environment loader in this monorepo.

export interface BlackboardEnvironment {
  readonly grpcBindAddress: string;
}

export class BlackboardConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Blackboard environment field ${field}: ${reason}`);
    this.name = "BlackboardConfigurationError";
  }
}

const { parseGrpcAddress } = createEnvironmentValidators(
  (field, reason) => new BlackboardConfigurationError(field, reason),
);

export function loadBlackboardEnvironment(
  environment: NodeJS.ProcessEnv,
): BlackboardEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.BLACKBOARD_GRPC_BIND_ADDRESS, "BLACKBOARD_GRPC_BIND_ADDRESS", "0.0.0.0:50057"),
  };
}

/** Parses a redis://host:port URL into RedisCacheProvider's host/port config shape. */
export function parseRedisHostPort(redisUrl: string): { host: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch (error: unknown) {
    throw new BlackboardConfigurationError(
      "REDIS_ENDPOINT",
      `is not a valid URL: ${(error as Error).message}`,
    );
  }
  const port = Number(parsed.port || "6379");
  if (parsed.hostname.length === 0 || !Number.isInteger(port)) {
    throw new BlackboardConfigurationError(
      "REDIS_ENDPOINT",
      "must include a hostname and a numeric port",
    );
  }
  return { host: parsed.hostname, port };
}
