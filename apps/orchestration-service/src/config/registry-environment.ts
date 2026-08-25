import { createEnvironmentValidators } from "@alterx/adapters";

// Config for the Node Type Registry (EXEC-1) only. Deliberately separate
// from environment.ts (Conversation Manager) -- same reasoning as
// compiler-environment.ts / workflow-lifecycle-environment.ts.

export interface RegistryEnvironment {
  readonly grpcBindAddress: string;
}

export class RegistryConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Node Type Registry environment field ${field}: ${reason}`);
    this.name = "RegistryConfigurationError";
  }
}

const { parseGrpcAddress } = createEnvironmentValidators(
  (field, reason) => new RegistryConfigurationError(field, reason),
);

export function loadRegistryEnvironment(
  environment: NodeJS.ProcessEnv,
): RegistryEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.REGISTRY_GRPC_BIND_ADDRESS, "REGISTRY_GRPC_BIND_ADDRESS", "0.0.0.0:50055"),
  };
}
