export interface RecoveryEnvironment {
  readonly grpcBindAddress: string;
  /**
   * HEAL-6: first real wiring of PlannerClient into orchestration-service's
   * bootstrap (the "replan" strategy's real dispatch target). No prior
   * convention existed for this -- disclosed new env var, default matches
   * intelligence-service's local `uv run uvicorn` dev port.
   */
  readonly plannerBaseUrl: string;
  /**
   * Real Policy Store read target (memory-service's
   * POST /memory/active-policy) -- closes the Self-Healing exit-check
   * gap where promoting a new recovery_preferences policy version had no
   * real consumer. Same "no prior convention, disclosed new env var"
   * situation as plannerBaseUrl above; default matches memory-service's
   * local `uv run uvicorn` dev port.
   */
  readonly memoryServiceBaseUrl: string;
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
  const plannerBaseUrl =
    environment.PLANNER_BASE_URL?.trim() ?? "http://localhost:8000";
  try {
    new URL(plannerBaseUrl);
  } catch {
    throw new RecoveryConfigurationError("PLANNER_BASE_URL must be a valid URL");
  }
  const memoryServiceBaseUrl =
    environment.MEMORY_SERVICE_BASE_URL?.trim() ?? "http://localhost:8002";
  try {
    new URL(memoryServiceBaseUrl);
  } catch {
    throw new RecoveryConfigurationError("MEMORY_SERVICE_BASE_URL must be a valid URL");
  }
  return { grpcBindAddress, plannerBaseUrl, memoryServiceBaseUrl };
}
