export interface WorkflowLifecycleEnvironment {
  readonly grpcBindAddress: string;
}

export class WorkflowLifecycleConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Workflow Lifecycle environment field ${field}: ${reason}`);
    this.name = "WorkflowLifecycleConfigurationError";
  }
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50054";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new WorkflowLifecycleConfigurationError(
      "DEPLOYCTL_GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new WorkflowLifecycleConfigurationError(
      "DEPLOYCTL_GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadWorkflowLifecycleEnvironment(
  environment: NodeJS.ProcessEnv,
): WorkflowLifecycleEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.DEPLOYCTL_GRPC_BIND_ADDRESS),
  };
}
