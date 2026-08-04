import { describe, expect, it } from "vitest";
import { EnvVarHttpError } from "./problem";
import {
  parseCreateEnvVar,
  parseEnvVarId,
  parseEnvVarProjectId,
  parseUpdateEnvVar,
} from "./validation";

const projectId = "prj_018f47a5-7b2c-7d10-8f11-123456789abc";
const id = "018f47a5-7b2c-7d10-8f11-123456789abd";
const instance = `/api/v1/projects/${projectId}/env-vars`;

describe("environment variable validation", () => {
  it("preserves secret bytes while trimming metadata", () => {
    expect(
      parseCreateEnvVar(
        {
          environment: " production ",
          key: " DATABASE_URL ",
          value: " secret\n",
        },
        instance,
      ),
    ).toEqual({
      environment: "production",
      key: "DATABASE_URL",
      value: " secret\n",
    });
    expect(parseEnvVarProjectId(projectId, instance)).toBe(projectId);
    expect(parseEnvVarId(id, instance)).toBe(id);
  });

  it("projects optional updates without undefined properties", () => {
    expect(parseUpdateEnvVar({ key: "API_KEY" }, instance)).toEqual({
      key: "API_KEY",
    });
    expect(
      parseUpdateEnvVar(
        { environment: "staging", value: " rotated " },
        instance,
      ),
    ).toEqual({ environment: "staging", value: " rotated " });
  });

  it("rejects blank values, invalid keys and ids, empty updates, and extras", () => {
    for (const input of [
      {},
      { value: "   " },
      { key: "BAD-KEY" },
      { key: "API_KEY", unknown: true },
    ]) {
      expect(() => parseUpdateEnvVar(input, instance)).toThrow(EnvVarHttpError);
    }
    expect(() => parseEnvVarProjectId("project-bad", instance)).toThrow(
      EnvVarHttpError,
    );
    expect(() => parseEnvVarId("env-bad", instance)).toThrow(EnvVarHttpError);
  });
});
