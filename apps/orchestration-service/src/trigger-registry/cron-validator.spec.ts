import { describe, expect, it } from "vitest";
import {
  InvalidCronExpressionError,
  computeNextCronFireTime,
  validateCronExpression,
} from "./cron-validator";

describe("cron-validator", () => {
  it("accepts a valid 5-field cron expression", () => {
    expect(() => validateCronExpression("*/5 * * * *")).not.toThrow();
  });

  it("rejects a malformed cron expression", () => {
    expect(() => validateCronExpression("not a cron")).toThrow(
      InvalidCronExpressionError,
    );
  });

  it("computes the next fire time relative to a given point", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const next = computeNextCronFireTime("0 * * * *", from);
    expect(next.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("computes the next fire time relative to now when no reference is given", () => {
    const next = computeNextCronFireTime("* * * * *");
    expect(next.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("includes the original expression in the error message", () => {
    try {
      validateCronExpression("bad expr");
      expect.fail("expected validateCronExpression to throw");
    } catch (error) {
      expect((error as Error).message).toContain("bad expr");
    }
  });
});
