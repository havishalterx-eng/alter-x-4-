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

  it("accepts optional tool permissions in the same AppConfig policy", () => {
    const policy = {
      ...validPolicy,
      tool_permissions: {
        "*:search.web": {
          allowed: true,
          rate_limit_per_minute: 60,
          required_scopes: ["tools:search"],
        },
      },
    };

    expect(ModelAliasPolicySchema.parse(policy)).toEqual(policy);
  });

  it("rejects malformed tool permissions", () => {
    expect(
      ModelAliasPolicySchema.safeParse({
        ...validPolicy,
        tool_permissions: {
          "*:search.web": {
            allowed: true,
            rate_limit_per_minute: 0,
            required_scopes: [],
          },
        },
      }).success,
    ).toBe(false);
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

  it("accepts a binding with an ordered fallback chain", () => {
    const withFallback = {
      ...validPolicy,
      bindings: {
        ...validPolicy.bindings,
        STANDARD: {
          model_id: "mock.standard.v1",
          capability_tags: ["general"],
          fallback_chain: [
            { provider: "anthropic", model_id: "claude-sonnet-5" },
            { provider: "openai", model_id: "gpt-5" },
          ],
        },
      },
    };
    expect(ModelAliasPolicySchema.parse(withFallback)).toEqual(withFallback);
  });

  it("rejects a fallback entry with an unknown provider", () => {
    expect(
      ModelAliasPolicySchema.safeParse({
        ...validPolicy,
        bindings: {
          ...validPolicy.bindings,
          STANDARD: {
            model_id: "mock.standard.v1",
            capability_tags: ["general"],
            fallback_chain: [{ provider: "azure", model_id: "gpt-5" }],
          },
        },
      }).success,
    ).toBe(false);
  });
});
