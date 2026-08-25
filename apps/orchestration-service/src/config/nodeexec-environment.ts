import { createEnvironmentValidators } from "@alterx/adapters";

// Config for the Node Execution Service (EXEC-6) only. Deliberately
// separate from environment.ts (Conversation Manager) -- same reasoning
// as compiler/registry/workflow-lifecycle-environment.ts.

export interface NodeexecEnvironment {
  readonly grpcBindAddress: string;
  readonly toolGatewayAddress: string;
  readonly sandboxServiceAddress: string;
  readonly verifyServiceAddress: string;
  readonly memoryServiceAddress: string;
  readonly memoryServiceAuthorization: string;
}

export class NodeexecConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Node Execution Service environment field ${field}: ${reason}`);
    this.name = "NodeexecConfigurationError";
  }
}

const { requireValue, parseGrpcAddress } = createEnvironmentValidators(
  (field, reason) => new NodeexecConfigurationError(field, reason),
);

export function loadNodeexecEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeexecEnvironment {
  const toolGatewayAddress = requireValue(environment, "TOOL_GATEWAY_ADDRESS");
  const sandboxServiceAddress = requireValue(environment, "SANDBOX_SERVICE_ADDRESS");
  const verifyServiceAddress = requireValue(environment, "VERIFY_SERVICE_ADDRESS");
  const memoryServiceAddress = requireValue(environment, "MEMORY_SERVICE_ADDRESS");
  const memoryServiceAuthorization = environment.MEMORY_SERVICE_AUTHORIZATION?.trim();
  if (
    memoryServiceAuthorization === undefined ||
    !memoryServiceAuthorization.startsWith("Bearer ") ||
    memoryServiceAuthorization.slice("Bearer ".length).trim().length === 0
  ) {
    throw new NodeexecConfigurationError(
      "MEMORY_SERVICE_AUTHORIZATION",
      "a non-empty Bearer token is required",
    );
  }
  return {
    grpcBindAddress: parseGrpcAddress(environment.NODEEXEC_GRPC_BIND_ADDRESS, "NODEEXEC_GRPC_BIND_ADDRESS", "0.0.0.0:50056"),
    toolGatewayAddress,
    sandboxServiceAddress,
    verifyServiceAddress,
    memoryServiceAddress,
    memoryServiceAuthorization,
  };
}
