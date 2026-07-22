import { describe, expect, it } from "vitest";
import { FieldErrorSchema, ProblemDetailsSchema } from "./problem-details";
import { ids } from "./test-fixtures";

const validProblem = {
  type: "https://errors.alter.ai/workflow/invalid-state",
  title: "Workflow state conflict",
  status: 409,
  detail: "The workflow cannot be activated while validation is pending.",
  instance: "/api/v1/workflows/wf_x/actions/activate",
  error_code: "WORKFLOW_INVALID_STATE",
  trace_id: ids.trace,
  request_id: ids.request,
  retryable: false,
  field_errors: [{ field: "status", message: "Validation is pending." }],
  documentation_key: "workflow.invalid-state",
};

describe("FieldErrorSchema", () => {
  it("accepts field and message", () => {
    expect(
      FieldErrorSchema.safeParse({ field: "name", message: "Required" })
        .success,
    ).toBe(true);
  });

  it("rejects a missing message", () => {
    expect(FieldErrorSchema.safeParse({ field: "name" }).success).toBe(false);
  });
});

describe("ProblemDetailsSchema", () => {
  it("accepts the RFC 9457 envelope", () => {
    expect(ProblemDetailsSchema.parse(validProblem)).toEqual(validProblem);
  });

  it("rejects invalid status values", () => {
    expect(
      ProblemDetailsSchema.safeParse({ ...validProblem, status: 99 }).success,
    ).toBe(false);
  });

  it("has no forbidden tenant or diagnostic fields", () => {
    const fieldNames = Object.keys(ProblemDetailsSchema.shape);
    const forbiddenPatterns = [
      /tenant/i,
      /stack/i,
      /sql/i,
      /secret/i,
      /provider_response/i,
      /model_response/i,
      /service_name/i,
    ];

    for (const pattern of forbiddenPatterns) {
      expect(fieldNames.some((field) => pattern.test(field))).toBe(false);
    }

    expect(
      ProblemDetailsSchema.safeParse({
        ...validProblem,
        tenant_id: ids.tenant,
      }).success,
    ).toBe(false);
  });
});
