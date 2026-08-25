import { createEnvironmentValidators } from "@alterx/adapters";

// Config for the Platform Jobs worker (Engagement Phase, doc 12). Own file,
// same reasoning as every other per-ticket environment loader in this
// monorepo: this ticket must not perturb any other ticket's wiring.

export interface PlatformJobWorkerEnvironment {
  readonly temporalAddress: string;
  readonly temporalNamespace: string;
  readonly temporalApiKey: string | undefined;
  readonly taskQueue: string;
}

export class PlatformJobWorkerConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(
      `Invalid Platform Job worker environment field ${field}: ${reason}`,
    );
    this.name = "PlatformJobWorkerConfigurationError";
  }
}

const { requireValue } = createEnvironmentValidators(
  (field, reason) => new PlatformJobWorkerConfigurationError(field, reason),
);

export function loadPlatformJobWorkerEnvironment(
  environment: NodeJS.ProcessEnv,
): PlatformJobWorkerEnvironment {
  return {
    temporalAddress: requireValue(environment, "TEMPORAL_ADDRESS"),
    temporalNamespace: requireValue(environment, "PLATFORM_TEMPORAL_NAMESPACE"),
    temporalApiKey: environment.TEMPORAL_API_KEY?.trim() || undefined,
    taskQueue: requireValue(environment, "PLATFORM_JOBS_TASK_QUEUE"),
  };
}
