// Config for the Node Type Registry (EXEC-1) only. Deliberately separate
// from environment.ts (Conversation Manager) -- same reasoning as
// compiler-environment.ts / deployment-controller-environment.ts.

export interface RegistryEnvironment {
  readonly grpcBindAddress: string;
}

export class RegistryConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Node Type Registry environment field ${field}: ${reason}`);
    this.name = "RegistryConfigurationError";
  }
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50055";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new RegistryConfigurationError(
      "REGISTRY_GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new RegistryConfigurationError(
      "REGISTRY_GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadRegistryEnvironment(
  environment: NodeJS.ProcessEnv,
): RegistryEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.REGISTRY_GRPC_BIND_ADDRESS),
  };
}
