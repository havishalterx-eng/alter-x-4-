import { describe, expect, it } from "vitest";
import {
  ProviderContractViolationError,
  assertProviderContractParity,
  runProviderContractTests,
  type ProviderContractRedactionContext,
  type ProviderContractSuite,
} from "./contract-testing";
import { createMockProvider } from "./mock-provider";
import {
  MOCK_SECRETS_CAPABILITIES,
  createMockSecretsProvider,
} from "./mocks/secrets-provider";
import { secretsProviderContract } from "./provider-contracts";
import { maskSecretLast4, secretLast4 } from "./secret-redaction";
import type { SecretsProvider } from "./provider-types";

const CONFIGURED_SECRET = "contract-secret-value";

function createLeakySecretsProvider(): SecretsProvider {
  const baseline = createMockSecretsProvider();
  return createMockProvider<SecretsProvider>({
    metadata: {
      ...baseline.metadata,
      providerId: "mock.leaky-secrets",
    },
    capabilities: MOCK_SECRETS_CAPABILITIES,
    implementation: {
      getSecret: async () => {
        throw new Error(`Resolution failed for ${CONFIGURED_SECRET}`);
      },
    },
  });
}

describe("provider contract report redaction", () => {
  it("never serializes a configured secret from the SecretsProvider suite", async () => {
    const implementations = [
      { name: "baseline", create: createMockSecretsProvider },
      { name: "leaky", create: createLeakySecretsProvider },
    ];
    const report = await runProviderContractTests(
      secretsProviderContract,
      implementations,
    );

    expect(report.passed).toBe(false);
    expect(JSON.stringify(report)).not.toContain(CONFIGURED_SECRET);

    let violation: unknown;
    try {
      await assertProviderContractParity(
        secretsProviderContract,
        implementations,
      );
    } catch (error) {
      violation = error;
    }

    expect(violation).toBeInstanceOf(ProviderContractViolationError);
    expect(JSON.stringify(violation)).not.toContain(CONFIGURED_SECRET);
    expect(String(violation)).not.toContain(CONFIGURED_SECRET);
  });

  it("applies a caller redaction hook before mandatory normalization", async () => {
    const sensitiveObservation = "future-provider-sensitive-value";
    const contexts: ProviderContractRedactionContext[] = [];
    const suite: ProviderContractSuite<SecretsProvider> = {
      name: "future-sensitive-provider",
      cases: [
        {
          name: "returns sensitive material",
          assert: () => ({ token: sensitiveObservation }),
        },
      ],
    };

    const report = await runProviderContractTests(
      suite,
      [
        { name: "baseline", create: createMockSecretsProvider },
        { name: "candidate", create: createMockSecretsProvider },
      ],
      {
        redact: (_value, context) => {
          contexts.push(context);
          return { redacted: true };
        },
      },
    );

    expect(report.passed).toBe(true);
    expect(contexts).toHaveLength(2);
    expect(contexts.every(({ channel }) => channel === "observation")).toBe(
      true,
    );
    expect(JSON.stringify(report)).not.toContain(sensitiveObservation);
  });

  it("retains only the final four characters for masked projections", () => {
    expect(secretLast4("super-secret-1234")).toBe("1234");
    expect(secretLast4("abc")).toBe("abc");
    expect(maskSecretLast4("1234")).toBe("****1234");
  });
});
