import { describe, expect, it } from "vitest";
import {
  InvalidDlqPolicyError,
  defaultDlqPolicy,
  validateDlqPolicy,
} from "./dlq-policy";

describe("dlq-policy", () => {
  it("returns defaults when given an empty object", () => {
    expect(validateDlqPolicy({})).toEqual(defaultDlqPolicy());
  });

  it("accepts an explicit valid policy", () => {
    expect(
      validateDlqPolicy({ maxReceiveCount: 3, visibilityTimeoutSeconds: 60 }),
    ).toEqual({ maxReceiveCount: 3, visibilityTimeoutSeconds: 60 });
  });

  it("rejects a non-object policy", () => {
    expect(() => validateDlqPolicy(null)).toThrow(InvalidDlqPolicyError);
    expect(() => validateDlqPolicy("bad")).toThrow(InvalidDlqPolicyError);
  });

  it("rejects maxReceiveCount below the minimum", () => {
    expect(() => validateDlqPolicy({ maxReceiveCount: 0 })).toThrow(
      InvalidDlqPolicyError,
    );
  });

  it("rejects maxReceiveCount above the maximum", () => {
    expect(() => validateDlqPolicy({ maxReceiveCount: 1001 })).toThrow(
      InvalidDlqPolicyError,
    );
  });

  it("rejects a non-integer maxReceiveCount", () => {
    expect(() => validateDlqPolicy({ maxReceiveCount: 1.5 })).toThrow(
      InvalidDlqPolicyError,
    );
  });

  it("rejects visibilityTimeoutSeconds above SQS's 12-hour ceiling", () => {
    expect(
      () => validateDlqPolicy({ visibilityTimeoutSeconds: 43_201 }),
    ).toThrow(InvalidDlqPolicyError);
  });

  it("accepts visibilityTimeoutSeconds at exactly the ceiling", () => {
    expect(
      validateDlqPolicy({ visibilityTimeoutSeconds: 43_200 }),
    ).toEqual({ maxReceiveCount: 5, visibilityTimeoutSeconds: 43_200 });
  });

  it("rejects a negative visibilityTimeoutSeconds", () => {
    expect(
      () => validateDlqPolicy({ visibilityTimeoutSeconds: -1 }),
    ).toThrow(InvalidDlqPolicyError);
  });
});
