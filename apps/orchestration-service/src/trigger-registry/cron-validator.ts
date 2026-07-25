import { CronExpressionParser } from "cron-parser";

export class InvalidCronExpressionError extends Error {
  constructor(expression: string, reason: string) {
    super(`Invalid cron expression "${expression}": ${reason}`);
    this.name = "InvalidCronExpressionError";
  }
}

/**
 * Validates a 5-field cron expression and returns the next fire time after
 * `from` (defaults to now). Timezone is always UTC -- trigger_versions.config
 * does not carry a per-trigger timezone field, and inventing one is out of
 * this ticket's scope; every cron trigger fires on UTC wall-clock time until
 * a real timezone field is added.
 */
export function computeNextCronFireTime(
  expression: string,
  from: Date = new Date(),
): Date {
  try {
    const interval = CronExpressionParser.parse(expression, {
      currentDate: from,
      tz: "UTC",
    });
    return interval.next().toDate();
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown parse error";
    throw new InvalidCronExpressionError(expression, reason);
  }
}

export function validateCronExpression(expression: string): void {
  computeNextCronFireTime(expression);
}
