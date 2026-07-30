import { describe, expect, it, vi } from "vitest";

import {
  PolicyStoreClient,
  PolicyStoreResponseValidationError,
  type PolicyStoreHttpClient,
} from "./policy-store-client";

function fakeHttpClient(response: unknown): {
  readonly client: PolicyStoreHttpClient;
  readonly calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  return {
    client: {
      async postJson(url, body) {
        calls.push({ url, body });
        return response;
      },
    },
    calls,
  };
}

const CONFIG = { baseUrl: "http://memory-service.internal" };

describe("PolicyStoreClient", () => {
  it("posts to /memory/active-policy and parses a found response", async () => {
    const { client, calls } = fakeHttpClient({
      found: true,
      policy_id: "pol_a",
      version: 3,
      body_json: '{"rules":{"timeout":"backoff"}}',
    });
    const policyStore = new PolicyStoreClient(CONFIG, client);

    const result = await policyStore.getActivePolicy({
      tenant_id: "ten_a",
      kind: "recovery_preferences",
    });

    expect(result).toEqual({
      found: true,
      policy_id: "pol_a",
      version: 3,
      body_json: '{"rules":{"timeout":"backoff"}}',
    });
    expect(calls).toEqual([
      {
        url: "http://memory-service.internal/memory/active-policy",
        body: { tenant_id: "ten_a", kind: "recovery_preferences" },
      },
    ]);
  });

  it("parses a real not-found response without treating it as an error", async () => {
    const { client } = fakeHttpClient({
      found: false,
      policy_id: null,
      version: null,
      body_json: null,
    });
    const policyStore = new PolicyStoreClient(CONFIG, client);

    const result = await policyStore.getActivePolicy({
      tenant_id: "ten_a",
      kind: "routing_weights",
    });

    expect(result.found).toBe(false);
    expect(result.policy_id).toBeNull();
  });

  it("rejects a response missing the required 'found' field", async () => {
    const { client } = fakeHttpClient({ policy_id: "pol_a" });
    const policyStore = new PolicyStoreClient(CONFIG, client);

    await expect(
      policyStore.getActivePolicy({ tenant_id: "ten_a", kind: "recovery_preferences" }),
    ).rejects.toThrow(PolicyStoreResponseValidationError);
  });

  it("propagates an HTTP client failure without swallowing it", async () => {
    const client: PolicyStoreHttpClient = {
      postJson: vi.fn(async () => {
        throw new Error("memory-service unreachable");
      }),
    };
    const policyStore = new PolicyStoreClient(CONFIG, client);

    await expect(
      policyStore.getActivePolicy({ tenant_id: "ten_a", kind: "recovery_preferences" }),
    ).rejects.toThrow("memory-service unreachable");
  });
});
