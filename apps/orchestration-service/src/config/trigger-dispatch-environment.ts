/**
 * INGR-7 environment for the trigger dispatch path: the EventBridge bus
 * the webhook/cron paths publish canonical trigger events to, and the
 * optional endpoint override used to point at LocalStack in development.
 * The bus must exist before the publisher is used; the local
 * localstack-init scripts provision alter-<env> and alter-<env>-events.fifo.
 */
export interface TriggerDispatchEnvironment {
  readonly eventBridgeBusName: string;
  readonly eventBridgeEndpoint: string | undefined;
}

export class TriggerDispatchConfigurationError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid trigger dispatch environment field ${field}: ${reason}`);
    this.name = "TriggerDispatchConfigurationError";
  }
}

export function loadTriggerDispatchEnvironment(
  environment: NodeJS.ProcessEnv,
): TriggerDispatchEnvironment {
  const busName = environment.EVENTBRIDGE_BUS_NAME?.trim();
  if (busName === undefined || busName.length === 0) {
    throw new TriggerDispatchConfigurationError(
      "EVENTBRIDGE_BUS_NAME",
      "a non-empty value is required",
    );
  }
  return {
    eventBridgeBusName: busName,
    eventBridgeEndpoint: environment.EVENTBRIDGE_ENDPOINT?.trim() || undefined,
  };
}