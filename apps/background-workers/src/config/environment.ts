import { createEnvironmentValidators } from "@alterx/adapters";

// Config for the Executor worker (EXEC-6). Kept in its own file, same
// reasoning as every other per-ticket environment loader in this monorepo:
// this ticket must not perturb any other ticket's wiring.

export interface ExecutorWorkerEnvironment {
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly temporalApiKey: string | undefined;
  readonly taskQueue: string;
  readonly nodeexecAddress: string;
  readonly blackboardAddress: string;
}

export class ExecutorWorkerConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid Executor worker environment field ${field}: ${reason}`);
    this.name = "ExecutorWorkerConfigurationError";
  }
}

const { requireValue } = createEnvironmentValidators(
  (field, reason) => new ExecutorWorkerConfigurationError(field, reason),
);

export function loadExecutorWorkerEnvironment(
  environment: NodeJS.ProcessEnv,
): ExecutorWorkerEnvironment {
  return {
    temporalAddress: requireValue(environment, "TEMPORAL_ADDRESS"),
    temporalNamespace: requireValue(environment, "TEMPORAL_NAMESPACE"),
    temporalApiKey: environment.TEMPORAL_API_KEY?.trim() || undefined,
    taskQueue: requireValue(environment, "EXECUTOR_TASK_QUEUE"),
    nodeexecAddress: requireValue(environment, "NODEEXEC_ADDRESS"),
    blackboardAddress: requireValue(environment, "BLACKBOARD_ADDRESS"),
  };
}
