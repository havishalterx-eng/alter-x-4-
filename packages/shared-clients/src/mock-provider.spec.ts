import { describe, expect, expectTypeOf, it } from "vitest";
import { createMockProvider } from "./mock-provider";
import { MOCK_SECRETS_CAPABILITIES } from "./mocks/secrets-provider";
import type { SecretsProvider } from "./provider-types";

describe("createMockProvider", () => {
  it("creates a deterministic, type-safe in-memory provider", async () => {
    const provider = createMockProvider<SecretsProvider>({
      metadata: {
        providerId: "mock.generic-secrets",
        interfaceName: "SecretsProvider",
        displayName: "Generic secret mock",
        version: "1.0.0",
        telemetryNamespace: "alter.mock.generic-secrets",
        supportsTenantOverrides: false,
        migration: {
          strategyVersion: "1",
          rollbackSupported: true,
        },
      },
      capabilities: MOCK_SECRETS_CAPABILITIES,
      implementation: {
        getSecret: async (referenceId) => `value-for:${referenceId}`,
      },
    });

    expectTypeOf(provider).toMatchTypeOf<SecretsProvider>();
    await expect(provider.getSecret("ref-1")).resolves.toBe(
      "value-for:ref-1",
    );
    await expect(provider.healthCheck()).resolves.toEqual({
      status: "healthy",
      checkedAt: "1970-01-01T00:00:00.000Z",
      latencyMs: 0,
    });
  });
});
