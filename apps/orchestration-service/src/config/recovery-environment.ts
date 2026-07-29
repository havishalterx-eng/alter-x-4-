export interface RecoveryEnvironment {
  readonly grpcBindAddress: string;
}

export class RecoveryConfigurationError extends Error {
  constructor(reason: string) {
    super(`Invalid Recovery Service environment: ${reason}`);
    this.name = "RecoveryConfigurationError";
  }
}

export function loadRecoveryEnvironment(
  environment: NodeJS.ProcessEnv,
): RecoveryEnvironment {
  const grpcBindAddress =
    environment.RECOVERY_GRPC_BIND_ADDRESS?.trim() ?? "0.0.0.0:50058";
  if (!/^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(grpcBindAddress)) {
    throw new RecoveryConfigurationError(
      "RECOVERY_GRPC_BIND_ADDRESS must be an IPv4 address and port",
    );
  }
  const port = Number(grpcBindAddress.slice(grpcBindAddress.lastIndexOf(":") + 1));
  if (port < 1 || port > 65_535) {
    throw new RecoveryConfigurationError(
      "RECOVERY_GRPC_BIND_ADDRESS port must be from 1 to 65535",
    );
  }
  return { grpcBindAddress };
}
