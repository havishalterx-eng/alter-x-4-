// Config for RunLauncherService (EXEC-14) to start/terminate the Executor's
// Temporal workflow. Deliberately reuses the same TEMPORAL_ADDRESS/
// TEMPORAL_NAMESPACE/TEMPORAL_API_KEY/EXECUTOR_TASK_QUEUE variable names as
// apps/background-workers's ExecutorWorkerEnvironment -- both sides must
// name the identical task queue for Temporal to dispatch what this
// launches to that worker.

export interface RunLauncherEnvironment {
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly temporalApiKey: string | undefined;
  readonly taskQueue: string;
}

export class RunLauncherConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid run launcher environment field ${field}: ${reason}`);
    this.name = "RunLauncherConfigurationError";
  }
}

function requireValue(environment: NodeJS.ProcessEnv, field: string): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new RunLauncherConfigurationError(field, "a non-empty value is required");
  }
  return value;
}

export function loadRunLauncherEnvironment(
  environment: NodeJS.ProcessEnv,
): RunLauncherEnvironment {
  return {
    temporalAddress: requireValue(environment, "TEMPORAL_ADDRESS"),
    temporalNamespace: requireValue(environment, "TEMPORAL_NAMESPACE"),
    temporalApiKey: environment.TEMPORAL_API_KEY?.trim() || undefined,
    taskQueue: requireValue(environment, "EXECUTOR_TASK_QUEUE"),
  };
}
