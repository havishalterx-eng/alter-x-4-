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

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50057";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new BlackboardConfigurationError(
      "BLACKBOARD_GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new BlackboardConfigurationError(
      "BLACKBOARD_GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadBlackboardEnvironment(
  environment: NodeJS.ProcessEnv,
): BlackboardEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.BLACKBOARD_GRPC_BIND_ADDRESS),
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
