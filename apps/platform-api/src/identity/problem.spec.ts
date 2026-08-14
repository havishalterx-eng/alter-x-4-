import { describe, expect, it } from "vitest";
import { IdentityHttpError, problemDetails } from "./problem";

describe("problemDetails", () => {
  it("passes through an IdentityHttpError's status and error code", () => {
    const problem = problemDetails(
      new IdentityHttpError(404, "USER_NOT_FOUND", "User profile not found"),
      "/api/v1/auth/me",
      "req_1",
    );

    expect(problem).toMatchObject({
      status: 404,
      error_code: "USER_NOT_FOUND",
      detail: "User profile not found",
      instance: "/api/v1/auth/me",
      trace_id: "req_1",
      request_id: "req_1",
    });
  });

  it("collapses an unexpected error into a generic 500 without leaking its message", () => {
    const problem = problemDetails(new Error("raw db connection string leaked here"), "/api/v1/auth/me", undefined);

    expect(problem).toMatchObject({
      status: 500,
      error_code: "IDENTITY_UNEXPECTED_ERROR",
      detail: "Identity request failed",
      trace_id: "trace-unavailable",
      request_id: "request-unavailable",
    });
    expect(JSON.stringify(problem)).not.toContain("raw db connection string");
  });
});
