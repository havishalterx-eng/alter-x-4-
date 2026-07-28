// Config for the Node Execution Service (EXEC-6) only. Deliberately
// separate from environment.ts (Conversation Manager) -- same reasoning
// as compiler/registry/deployment-controller-environment.ts.

export interface NodeexecEnvironment {
  readonly grpcBindAddress: string;
}

export class NodeexecConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Node Execution Service environment field ${field}: ${reason}`);
    this.name = "NodeexecConfigurationError";
  }
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50056";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new NodeexecConfigurationError(
      "NODEEXEC_GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new NodeexecConfigurationError(
      "NODEEXEC_GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadNodeexecEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeexecEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.NODEEXEC_GRPC_BIND_ADDRESS),
  };
}
