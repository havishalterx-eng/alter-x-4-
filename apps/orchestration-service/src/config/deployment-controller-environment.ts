export interface DeploymentControllerEnvironment {
  readonly grpcBindAddress: string;
}

export class DeploymentControllerConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Deployment Controller environment field ${field}: ${reason}`);
    this.name = "DeploymentControllerConfigurationError";
  }
}

function parseGrpcAddress(value: string | undefined): string {
  const address = value?.trim() ?? "0.0.0.0:50054";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(address)) {
    throw new DeploymentControllerConfigurationError(
      "DEPLOYCTL_GRPC_BIND_ADDRESS",
      "must be an IPv4 address and port",
    );
  }
  const port = Number(address.slice(address.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new DeploymentControllerConfigurationError(
      "DEPLOYCTL_GRPC_BIND_ADDRESS",
      "port must be from 1 to 65535",
    );
  }
  return address;
}

export function loadDeploymentControllerEnvironment(
  environment: NodeJS.ProcessEnv,
): DeploymentControllerEnvironment {
  return {
    grpcBindAddress: parseGrpcAddress(environment.DEPLOYCTL_GRPC_BIND_ADDRESS),
  };
}
