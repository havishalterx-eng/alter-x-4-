import { describe, expect, it } from "vitest";
import { CredentialHttpError } from "./problem";
import {
  parseCreateCredential,
  parseCredentialId,
  parseUpdateCredential,
} from "./validation";

const instance = "/api/v1/credentials";
const id = "018f47a5-7b2c-7d10-8f11-123456789abc";

describe("credential validation", () => {
  it("preserves secret bytes while trimming metadata", () => {
    expect(
      parseCreateCredential(
        {
          name: " DB ",
          connector: " postgres ",
          scope: " deploy ",
          value: " secret\n",
        },
        instance,
      ),
    ).toEqual({
      name: "DB",
      connector: "postgres",
      scope: "deploy",
      value: " secret\n",
    });
    expect(parseCredentialId(id, instance)).toBe(id);
  });

  it("projects every optional update without undefined properties", () => {
    expect(parseUpdateCredential({ name: "DB" }, instance)).toEqual({
      name: "DB",
    });
    expect(
      parseUpdateCredential(
        {
          connector: "postgres",
          scope: "deploy",
          value: " secret ",
        },
        instance,
      ),
    ).toEqual({
      connector: "postgres",
      scope: "deploy",
      value: " secret ",
    });
  });

  it("rejects empty updates, malformed ids, unknown fields, and blank values", () => {
    for (const input of [
      {},
      { name: "DB", unknown: true },
      { value: "   " },
    ]) {
      expect(() => parseUpdateCredential(input, instance)).toThrow(
        CredentialHttpError,
      );
    }
    expect(() => parseCredentialId("cred_bad", instance)).toThrow(
      CredentialHttpError,
    );
  });
});
