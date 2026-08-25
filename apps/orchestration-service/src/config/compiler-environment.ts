import { createEnvironmentValidators } from "@alterx/adapters";

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

const { parseGrpcAddress } = createEnvironmentValidators(
  (field, reason) => new CompilerConfigurationError(field, reason),
);

export function loadCompilerEnvironment(
  environment: NodeJS.ProcessEnv,
): CompilerEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.COMPILER_GRPC_BIND_ADDRESS, "COMPILER_GRPC_BIND_ADDRESS", "0.0.0.0:50053"),
  };
}
