import { z } from "zod";
import { EventHttpError } from "./problem";
import type { EventListQuery } from "./types";

const uuidV7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const eventIdPattern = new RegExp(`^evt_${uuidV7}$`, "i");
const traceparentPattern = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

// Only these 3 are derivable from the events table today -- see
// EventQueryService's own comment in orchestration-service. Rejecting
// "matched"/"ignored" here (same as the query service itself does) gives a
// fast, clear 400 without a round trip to Engine.
const listQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    source: z.string().min(1).max(100).optional(),
    status: z.enum(["received", "triggered", "failed"]).optional(),
  })
  .strict();

export function parseEventListQuery(input: unknown, instance: string): EventListQuery {
  return parse(listQuerySchema, input, instance);
}

export function parseEventId(value: string, instance: string): string {
  if (!eventIdPattern.test(value)) {
    throw validationError(instance, [{ field: "eventId", message: "Expected evt_ UUIDv7" }]);
  }
  return value;
}

export function parseTraceparent(value: string | undefined, instance: string): string | undefined {
  if (value !== undefined && !traceparentPattern.test(value)) {
    throw validationError(instance, [{ field: "traceparent", message: "Expected W3C traceparent" }]);
  }
  return value;
}

export function serializeQuery(query: object): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const serialized = parameters.toString();
  return serialized ? `?${serialized}` : "";
}

function parse<T>(schema: z.ZodType<T>, input: unknown, instance: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw validationError(
    instance,
    result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "query",
      message: issue.message,
    })),
  );
}

function validationError(
  instance: string,
  fieldErrors: NonNullable<ConstructorParameters<typeof EventHttpError>[4]>,
): EventHttpError {
  return new EventHttpError(400, "INVALID_EVENT_REQUEST", "Event request validation failed", instance, fieldErrors);
}
