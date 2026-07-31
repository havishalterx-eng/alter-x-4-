export interface RunsEnvironment {
  readonly grpcBindAddress: string;
}

export class RunsConfigurationError extends Error {
  constructor(reason: string) {
    super(`Invalid Runs Lookup Service environment: ${reason}`);
    this.name = "RunsConfigurationError";
  }
}

export function loadRunsEnvironment(
  environment: NodeJS.ProcessEnv,
): RunsEnvironment {
  const grpcBindAddress =
    environment.RUNS_GRPC_BIND_ADDRESS?.trim() ?? "0.0.0.0:50059";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(grpcBindAddress)) {
    throw new RunsConfigurationError(
      "RUNS_GRPC_BIND_ADDRESS must be an IPv4 address and port",
    );
  }
  const port = Number(grpcBindAddress.slice(grpcBindAddress.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new RunsConfigurationError(
      "RUNS_GRPC_BIND_ADDRESS port must be from 1 to 65535",
    );
  }
  return { grpcBindAddress };
}
