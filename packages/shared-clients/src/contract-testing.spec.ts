import { describe, expect, it } from "vitest";
import {
  ProviderContractConfigurationError,
  ProviderContractParityError,
  ProviderContractViolationError,
  assertProviderContractParity,
  runProviderContractTests,
  type ProviderContractSuite,
} from "./contract-testing";
import {
  durableExecutionProviderContract,
  observabilityProviderContract,
  secretsProviderContract,
} from "./provider-contracts";
import { createMockDurableExecutionProvider } from "./mocks/durable-execution-provider";
import { createMockObservabilityProvider } from "./mocks/observability-provider";
import { createMockSecretsProvider } from "./mocks/secrets-provider";
import type { SecretsProvider } from "./provider-types";

describe("provider contract runner", () => {
  it("proves mock-vs-mock parity for SecretsProvider", async () => {
    const report = await assertProviderContractParity(
      secretsProviderContract,
      [
        { name: "mock-primary", create: createMockSecretsProvider },
        { name: "mock-parity", create: createMockSecretsProvider },
      ],
    );

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(4);
  });

  it("proves mock-vs-mock parity for ObservabilityProvider", async () => {
    const report = await assertProviderContractParity(
      observabilityProviderContract,
      [
        { name: "mock-primary", create: createMockObservabilityProvider },
        { name: "mock-parity", create: createMockObservabilityProvider },
      ],
    );

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(10);
  });

  it("proves mock-vs-mock parity for DurableExecutionProvider", async () => {
    const report = await assertProviderContractParity(
      durableExecutionProviderContract,
      [
        {
          name: "mock-primary",
          create: createMockDurableExecutionProvider,
        },
        {
          name: "mock-parity",
          create: createMockDurableExecutionProvider,
        },
      ],
    );

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(4);
  });

  it("reports violations from either implementation without hiding the cause", async () => {
    const failingSuite: ProviderContractSuite<SecretsProvider> = {
      name: "failing-secrets",
      cases: [
        {
          name: "requires a different fixture",
          assert: async (provider) => {
            if ((await provider.getSecret("contract/secret")) !== "other") {
              throw new Error("fixture mismatch");
            }
          },
        },
      ],
    };
    const implementations = [
      { name: "first", create: createMockSecretsProvider },
      { name: "second", create: createMockSecretsProvider },
    ];

    const report = await runProviderContractTests(
      failingSuite,
      implementations,
    );
    expect(report.passed).toBe(false);
    expect(report.results).toMatchObject([
      { implementationName: "first", passed: false },
      { implementationName: "second", passed: false },
    ]);
    await expect(
      assertProviderContractParity(failingSuite, implementations),
    ).rejects.toBeInstanceOf(ProviderContractViolationError);
  });

  it("fails parity when implementations return different successful results", async () => {
    const divergentSuite: ProviderContractSuite<SecretsProvider> = {
      name: "divergent-secrets",
      cases: [
        {
          name: "returns the resolved secret",
          assert: (provider) => provider.getSecret("contract/secret"),
        },
      ],
    };
    const implementations = [
      {
        name: "baseline",
        create: () =>
          createMockSecretsProvider({
            secrets: { "contract/secret": "A" },
          }),
      },
      {
        name: "divergent",
        create: () =>
          createMockSecretsProvider({
            secrets: { "contract/secret": "B" },
          }),
      },
    ];

    const report = await runProviderContractTests(
      divergentSuite,
      implementations,
    );

    expect(report.passed).toBe(false);
    expect(report.results).toMatchObject([
      {
        implementationName: "baseline",
        passed: true,
        outcome: { status: "fulfilled" },
      },
      {
        implementationName: "divergent",
        passed: false,
        outcome: { status: "fulfilled" },
      },
    ]);
    expect(report.results[0]?.outcome).not.toEqual(
      report.results[1]?.outcome,
    );
    expect(report.results[1]?.error).toBeInstanceOf(
      ProviderContractParityError,
    );
    await expect(
      assertProviderContractParity(divergentSuite, implementations),
    ).rejects.toBeInstanceOf(ProviderContractViolationError);
  });

  it("rejects empty suites and single-implementation parity runs", async () => {
    await expect(
      runProviderContractTests(
        { name: "empty", cases: [] },
        [
          { name: "first", create: createMockSecretsProvider },
          { name: "second", create: createMockSecretsProvider },
        ],
      ),
    ).rejects.toBeInstanceOf(ProviderContractConfigurationError);

    await expect(
      runProviderContractTests(secretsProviderContract, [
        { name: "only", create: createMockSecretsProvider },
      ]),
    ).rejects.toBeInstanceOf(ProviderContractConfigurationError);
  });
});
