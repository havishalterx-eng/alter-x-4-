// Config for the Graph Compiler (PLAN-9) only. Deliberately separate from
// environment.ts (Conversation Manager) so this ticket can't perturb that
// wiring -- same reasoning as conversation-dispatch-environment.ts.

export interface CompilerEnvironment {
  readonly grpcBindAddress: string;
}

export class CompilerConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Graph Compiler environment field ${field}: ${reason}`);
    this.name = "CompilerConfigurationError";
  }
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50053";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new CompilerConfigurationError(
      "COMPILER_GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new CompilerConfigurationError(
      "COMPILER_GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadCompilerEnvironment(
  environment: NodeJS.ProcessEnv,
): CompilerEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.COMPILER_GRPC_BIND_ADDRESS),
  };
}
