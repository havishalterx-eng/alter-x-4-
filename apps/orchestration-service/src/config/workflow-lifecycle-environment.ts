import { createEnvironmentValidators } from "@alterx/adapters";

export interface WorkflowLifecycleEnvironment {
  readonly grpcBindAddress: string;
}

export class WorkflowLifecycleConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Workflow Lifecycle environment field ${field}: ${reason}`);
    this.name = "WorkflowLifecycleConfigurationError";
  }
}

const { parseGrpcAddress } = createEnvironmentValidators(
  (field, reason) => new WorkflowLifecycleConfigurationError(field, reason),
);

export function loadWorkflowLifecycleEnvironment(
  environment: NodeJS.ProcessEnv,
): WorkflowLifecycleEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.DEPLOYCTL_GRPC_BIND_ADDRESS, "DEPLOYCTL_GRPC_BIND_ADDRESS", "0.0.0.0:50054"),
  };
}
