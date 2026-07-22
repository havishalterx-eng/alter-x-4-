import { describe, expect, it } from "vitest";
import {
  CapabilityRegistrationError,
  CapabilityRegistry,
  CapabilityRequirementsError,
} from "./capability-registry";
import {
  MOCK_DURABLE_EXECUTION_CAPABILITIES,
  createMockDurableExecutionProvider,
} from "./mocks/durable-execution-provider";
import {
  MOCK_OBSERVABILITY_CAPABILITIES,
  createMockObservabilityProvider,
} from "./mocks/observability-provider";
import {
  MOCK_SECRETS_CAPABILITIES,
  createMockSecretsProvider,
} from "./mocks/secrets-provider";

describe("CapabilityRegistry", () => {
  it("registers and retrieves validated immutable capabilities", () => {
    const registry = new CapabilityRegistry();
    registry.register("mock.secrets", MOCK_SECRETS_CAPABILITIES);

    const registered = registry.get("mock.secrets");
    expect(registered).toEqual(MOCK_SECRETS_CAPABILITIES);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(registry.get("missing")).toBeUndefined();
  });

  it("throws a typed error for malformed registrations", () => {
    const registry = new CapabilityRegistry();
    const invalid = {
      ...MOCK_SECRETS_CAPABILITIES,
      maximum_payload: 0,
    };

    expect(() => registry.register("invalid", invalid)).toThrow(
      CapabilityRegistrationError,
    );
    expect(() => registry.register(" invalid ", invalid)).toThrow(
      CapabilityRegistrationError,
    );
  });

  it("resolves only providers satisfying boolean, subset, and threshold requirements", () => {
    const registry = new CapabilityRegistry();
    registry.register("mock.secrets", MOCK_SECRETS_CAPABILITIES);
    registry.register(
      "mock.observability",
      MOCK_OBSERVABILITY_CAPABILITIES,
    );
    registry.register(
      "mock.durable-execution",
      MOCK_DURABLE_EXECUTION_CAPABILITIES,
    );

    expect(
      registry.resolve({
        streaming: true,
        regional_availability: ["local"],
        maximum_payload: 1_000_000,
      }),
    ).toEqual(["mock.durable-execution"]);
    expect(
      registry.resolve({ maximum_payload: 100_000 }),
    ).toEqual(["mock.observability", "mock.durable-execution"]);
  });

  it("treats cost requirements as maximum rates and rejects malformed requirements", () => {
    const registry = new CapabilityRegistry();
    registry.register("priced", {
      ...MOCK_SECRETS_CAPABILITIES,
      cost_model: {
        rates: [
          {
            unit: "request",
            currency_code: "USD",
            amount: 0.01,
          },
        ],
      },
    });

    expect(
      registry.resolve({
        cost_model: {
          rates: [
            {
              unit: "request",
              currency_code: "USD",
              amount: 0.02,
            },
          ],
        },
      }),
    ).toEqual(["priced"]);
    expect(() =>
      registry.resolve({ maximum_payload: 0 }),
    ).toThrow(CapabilityRequirementsError);
  });

  it("registers every proof-of-pattern mock under its own ID", () => {
    const registry = new CapabilityRegistry();
    const providers = [
      createMockSecretsProvider(),
      createMockObservabilityProvider(),
      createMockDurableExecutionProvider(),
    ];

    for (const provider of providers) {
      registry.register(
        provider.metadata.providerId,
        provider.capabilities,
      );
    }

    expect(registry.resolve({ structured_output: true })).toEqual([
      "mock.secrets",
      "mock.observability",
      "mock.durable-execution",
    ]);
  });
});
