import { describe, expect, it } from "vitest";
import { ModelAliasPolicySchema, ModelAliasSchema } from "./model-alias-policy";

const validPolicy = {
  version: "2026-07-24.1",
  bindings: {
    FAST: { model_id: "mock.fast.v1", capability_tags: ["low-latency"] },
    STANDARD: { model_id: "mock.standard.v1", capability_tags: ["general"] },
    ADVANCED: { model_id: "mock.advanced.v1", capability_tags: ["reasoning"] },
    CEILING: { model_id: "mock.ceiling.v1", capability_tags: ["frontier"] },
  },
};

describe("ModelAliasSchema", () => {
  it("accepts exactly the four alias tiers", () => {
    expect(ModelAliasSchema.options).toEqual([
      "FAST",
      "STANDARD",
      "ADVANCED",
      "CEILING",
    ]);
  });

  it("rejects an unknown alias", () => {
    expect(ModelAliasSchema.safeParse("ULTRA").success).toBe(false);
  });
});

describe("ModelAliasPolicySchema", () => {
  it("accepts a policy with all four bindings", () => {
    expect(ModelAliasPolicySchema.parse(validPolicy)).toEqual(validPolicy);
  });

  it("rejects a policy missing a tier binding", () => {
    const rest = {
      FAST: validPolicy.bindings.FAST,
      STANDARD: validPolicy.bindings.STANDARD,
      ADVANCED: validPolicy.bindings.ADVANCED,
    };
    expect(
      ModelAliasPolicySchema.safeParse({ ...validPolicy, bindings: rest })
        .success,
    ).toBe(false);
  });

  it("rejects an empty model_id", () => {
    expect(
      ModelAliasPolicySchema.safeParse({
        ...validPolicy,
        bindings: {
          ...validPolicy.bindings,
          FAST: { model_id: "", capability_tags: [] },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects an unversioned policy", () => {
    expect(
      ModelAliasPolicySchema.safeParse({ ...validPolicy, version: "" })
        .success,
    ).toBe(false);
  });
});
