import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
  approvePlanSchema,
  clarificationAnswerSchema,
  createProjectSchema,
  parseClarificationId,
  parseProjectId,
  parseProjectInput,
  parseTraceparent,
  rejectPlanSchema,
  requestPlanChangesSchema,
  startBuildSchema,
} from "./validation";

const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const clarificationId = "clr_018f47a5-7b2c-7d10-8f11-123456789abc";
const traceparent =
  "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";

describe("project validation", () => {
  it("parses all valid inputs and identifiers", () => {
    expect(
      parseProjectInput(
        createProjectSchema,
        { brief: " Build project " },
        "/projects",
      ),
    ).toEqual({ brief: "Build project" });
    expect(
      parseProjectInput(
        clarificationAnswerSchema,
        { answer: " Use PostgreSQL\n" },
        "/answer",
      ),
    ).toEqual({ answer: " Use PostgreSQL\n" });
    expect(
      parseProjectInput(rejectPlanSchema, { reason: " no tests " }, "/reject"),
    ).toEqual({ reason: "no tests" });
    expect(
      parseProjectInput(
        requestPlanChangesSchema,
        { changes: " add tests " },
        "/changes",
      ),
    ).toEqual({ changes: "add tests" });
    expect(parseProjectInput(approvePlanSchema, undefined, "/approve")).toEqual(
      {},
    );
    expect(parseProjectInput(startBuildSchema, {}, "/build")).toEqual({});
    expect(parseProjectId(projectId, "/project")).toBe(projectId);
    expect(parseClarificationId(clarificationId, "/clarification")).toBe(
      clarificationId,
    );
    expect(parseTraceparent(traceparent, "/project")).toBe(traceparent);
    expect(parseTraceparent(undefined, "/project")).toBeUndefined();
  });

  it.each([
    [createProjectSchema, { brief: "" }],
    [clarificationAnswerSchema, { answer: "" }],
    [clarificationAnswerSchema, { answer: " \n\t " }],
    [rejectPlanSchema, {}],
    [requestPlanChangesSchema, { changes: "", extra: true }],
    [approvePlanSchema, { extra: true }],
    [startBuildSchema, { unexpected: true }],
  ])("returns RFC 9457 field errors for invalid body", (schema, input) => {
    expect(() =>
      parseProjectInput(schema as ZodType<unknown>, input, "/invalid"),
    ).toThrowError(
      expect.objectContaining({
        status: 400,
        response: expect.objectContaining({
          error_code: "PROJECT_VALIDATION_FAILED",
          field_errors: expect.any(Array),
        }),
      }),
    );
  });

  it("rejects invalid traceparent", () => {
    expect(() => parseTraceparent("bad", "/projects")).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({
          field_errors: [
            { field: "traceparent", message: "Invalid traceparent header" },
          ],
        }),
      }),
    );
  });
});
