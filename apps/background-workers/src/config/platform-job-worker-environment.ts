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

function requireValue(environment: NodeJS.ProcessEnv, field: string): string {
  const value = environment[field]?.trim();
  if (value === undefined || value.length === 0) {
    throw new PlatformJobWorkerConfigurationError(
      field,
      "a non-empty value is required",
    );
  }
  return value;
}

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
