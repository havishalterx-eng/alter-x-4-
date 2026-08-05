import type { JsonValue } from "@alterx/shared-clients";

export interface PlatformJobHandlerInput {
  readonly jobType: string;
  readonly payloadJson: string;
}

export interface PlatformJobHandlerResult {
  readonly resultJson: string;
}

export type PlatformJobHandler = (
  payload: JsonValue,
) => Promise<JsonValue>;

export class UnknownPlatformJobTypeError extends Error {
  constructor(jobType: string) {
    super(`No platform job handler registered for job type "${jobType}"`);
    this.name = "UnknownPlatformJobTypeError";
  }
}

export interface PlatformJobActivities {
  executePlatformJob(
    input: PlatformJobHandlerInput,
  ): Promise<PlatformJobHandlerResult>;
}

/**
 * Real, generic dispatch-by-type activity -- mirrors EXEC-1's Node Type
 * Registry pattern. Each real Platform Job type (ingestion coordination,
 * exports, notification fan-out, etc.) registers its own handler here;
 * the workflow itself stays generic and never grows per job type.
 */
export function createPlatformJobActivities(
  handlers: ReadonlyMap<string, PlatformJobHandler>,
): PlatformJobActivities {
  return {
    async executePlatformJob(
      input: PlatformJobHandlerInput,
    ): Promise<PlatformJobHandlerResult> {
      const handler = handlers.get(input.jobType);
      if (!handler) {
        throw new UnknownPlatformJobTypeError(input.jobType);
      }
      const payload = JSON.parse(input.payloadJson) as JsonValue;
      const result = await handler(payload);
      return { resultJson: JSON.stringify(result) };
    },
  };
}
