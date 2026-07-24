import {
  GetLatestConfigurationCommand,
  StartConfigurationSessionCommand,
} from "@aws-sdk/client-appconfigdata";
import {
  assertProviderContractParity,
  configProviderContract,
  createMockConfigProvider,
  type ConfigProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  APPCONFIG_CAPABILITIES,
  AwsAppConfigConfigProvider,
  type AppConfigDataCommandClient,
} from "./appconfig-config-provider";

const FIXED_CHECKED_AT = "2026-07-24T00:00:00.000Z";

const VALID_POLICY = {
  version: "2026-07-24.1",
  bindings: {
    FAST: { model_id: "amazon.nova-2-lite", capability_tags: ["low-latency"] },
    STANDARD: { model_id: "anthropic.claude-sonnet-5", capability_tags: ["general"] },
    ADVANCED: { model_id: "anthropic.claude-opus-4-8", capability_tags: ["reasoning"] },
    CEILING: { model_id: "anthropic.claude-fable-5", capability_tags: ["frontier"] },
  },
  tool_permissions: {
    "*:contract.search": {
      allowed: true,
      rate_limit_per_minute: 60,
      required_scopes: [],
    },
    "tenant-1:search.web": {
      allowed: true,
      rate_limit_per_minute: 30,
      required_scopes: ["tools:search"],
    },
    "*:admin.tool": {
      allowed: false,
      rate_limit_per_minute: 1,
      required_scopes: ["tools:admin"],
    },
  },
};

function encodedPolicy(policy: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(policy));
}

function baseConfig() {
  return {
    region: "ap-south-1",
    applicationIdentifier: "app-1",
    environmentIdentifier: "env-1",
    configurationProfileIdentifier: "profile-1",
  };
}

function realProvider(): ConfigProvider {
  // Contract cases call resolveModelAlias/healthCheck repeatedly, so this
  // fake always returns the full policy rather than only once -- a real
  // AppConfigData deployment may do the same across polling intervals.
  const send = vi.fn(
    async (
      command:
        | StartConfigurationSessionCommand
        | GetLatestConfigurationCommand,
    ) => {
      if (command instanceof StartConfigurationSessionCommand) {
        return { InitialConfigurationToken: "token-1" };
      }
      return {
        Configuration: encodedPolicy(VALID_POLICY),
        NextPollConfigurationToken: "token-2",
      };
    },
  );
  return new AwsAppConfigConfigProvider(
    baseConfig(),
    { send } as unknown as AppConfigDataCommandClient,
    () => new Date(FIXED_CHECKED_AT),
  );
}

function equivalentMockProvider(): ConfigProvider {
  // Configured with the exact same policy, capabilities, and health output
  // as realProvider() so the shared contract suite can compare them
  // implementation-for-implementation, not just each against itself.
  return createMockConfigProvider({
    policy: VALID_POLICY,
    resolveToolPermission: async ({ tenantId, toolName }) => {
      const binding =
        VALID_POLICY.tool_permissions[
          `${tenantId}:${toolName}` as keyof typeof VALID_POLICY.tool_permissions
        ] ??
        VALID_POLICY.tool_permissions[
          `*:${toolName}` as keyof typeof VALID_POLICY.tool_permissions
        ];
      return {
        allowed: binding.allowed,
        rateLimitPerMinute: binding.rate_limit_per_minute,
        requiredScopes: binding.required_scopes,
      };
    },
    capabilities: APPCONFIG_CAPABILITIES,
    health: {
      status: "healthy",
      checkedAt: FIXED_CHECKED_AT,
      latencyMs: 0,
      details: { configured: true },
    },
  });
}

describe("AwsAppConfigConfigProvider", () => {
  it("starts a session then resolves every alias from the fetched policy", async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(async (command: StartConfigurationSessionCommand) => {
        expect(command.input.ApplicationIdentifier).toBe("app-1");
        expect(command.input.EnvironmentIdentifier).toBe("env-1");
        expect(command.input.ConfigurationProfileIdentifier).toBe("profile-1");
        return { InitialConfigurationToken: "token-1" };
      })
      .mockImplementationOnce(async (command: GetLatestConfigurationCommand) => {
        expect(command.input.ConfigurationToken).toBe("token-1");
        return {
          Configuration: encodedPolicy(VALID_POLICY),
          NextPollConfigurationToken: "token-2",
        };
      });
    const provider = new AwsAppConfigConfigProvider(baseConfig(), {
      send,
    } as unknown as AppConfigDataCommandClient);

    await expect(provider.resolveModelAlias("STANDARD")).resolves.toEqual({
      model_id: "anthropic.claude-sonnet-5",
      capability_tags: ["general"],
    });
  });

  it("reuses the cached policy when AppConfig reports no change", async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(async () => ({
        InitialConfigurationToken: "token-1",
      }))
      .mockImplementationOnce(async () => ({
        Configuration: encodedPolicy(VALID_POLICY),
        NextPollConfigurationToken: "token-2",
      }))
      .mockImplementationOnce(async (command: GetLatestConfigurationCommand) => {
        expect(command.input.ConfigurationToken).toBe("token-2");
        return { Configuration: new Uint8Array(0), NextPollConfigurationToken: "token-3" };
      });
    const provider = new AwsAppConfigConfigProvider(baseConfig(), {
      send,
    } as unknown as AppConfigDataCommandClient);

    await provider.resolveModelAlias("FAST");
    await expect(provider.resolveModelAlias("CEILING")).resolves.toEqual({
      model_id: "anthropic.claude-fable-5",
      capability_tags: ["frontier"],
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("throws when AppConfig reports no change but nothing has been cached yet", async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(async () => ({
        InitialConfigurationToken: "token-1",
      }))
      .mockImplementationOnce(async () => ({
        Configuration: new Uint8Array(0),
      }));
    const provider = new AwsAppConfigConfigProvider(baseConfig(), {
      send,
    } as unknown as AppConfigDataCommandClient);

    await expect(provider.resolveModelAlias("FAST")).rejects.toThrow(
      /no policy has been cached/,
    );
  });

  it("rejects a malformed policy payload instead of resolving a stale binding", async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(async () => ({
        InitialConfigurationToken: "token-1",
      }))
      .mockImplementationOnce(async () => ({
        Configuration: encodedPolicy({ version: "1", bindings: {} }),
      }));
    const provider = new AwsAppConfigConfigProvider(baseConfig(), {
      send,
    } as unknown as AppConfigDataCommandClient);

    await expect(provider.resolveModelAlias("FAST")).rejects.toThrow();
  });

  it("reports unhealthy without throwing when the fetch fails", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network unreachable"));
    const provider = new AwsAppConfigConfigProvider(baseConfig(), {
      send,
    } as unknown as AppConfigDataCommandClient);

    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "unhealthy",
    });
  });

  it("resolves tool permissions from the fetched AppConfig policy and fails closed by default", async () => {
    const send = vi
      .fn()
      .mockImplementationOnce(async () => ({
        InitialConfigurationToken: "token-1",
      }))
      .mockImplementation(async () => ({
        Configuration: encodedPolicy(VALID_POLICY),
        NextPollConfigurationToken: "token-2",
      }));
    const provider = new AwsAppConfigConfigProvider(baseConfig(), {
      send,
    } as unknown as AppConfigDataCommandClient);
    await expect(
      provider.resolveToolPermission({
        tenantId: "tenant-1",
        toolName: "search.web",
      }),
    ).resolves.toEqual({
      allowed: true,
      rateLimitPerMinute: 30,
      requiredScopes: ["tools:search"],
    });
    await expect(
      provider.resolveToolPermission({
        tenantId: "tenant-1",
        toolName: "admin.tool",
      }),
    ).resolves.toEqual({
      allowed: false,
      rateLimitPerMinute: 1,
      requiredScopes: ["tools:admin"],
    });
    await expect(
      provider.resolveToolPermission({
        tenantId: "tenant-1",
        toolName: "unknown.tool",
      }),
    ).resolves.toEqual({
      allowed: false,
      rateLimitPerMinute: 1,
      requiredScopes: [],
    });
  });

  it("validates required identifiers at construction", () => {
    expect(
      () =>
        new AwsAppConfigConfigProvider({
          ...baseConfig(),
          applicationIdentifier: "",
        }),
    ).toThrow(/application identifier/);
    expect(
      () =>
        new AwsAppConfigConfigProvider({
          ...baseConfig(),
          environmentIdentifier: "",
        }),
    ).toThrow(/environment identifier/);
    expect(
      () =>
        new AwsAppConfigConfigProvider({
          ...baseConfig(),
          configurationProfileIdentifier: "",
        }),
    ).toThrow(/configuration profile identifier/);
  });
});

describe("ConfigProvider contract", () => {
  it("passes the unmodified shared contract suite with the real AppConfig adapter", async () => {
    const report = await assertProviderContractParity(configProviderContract, [
      { name: "appconfig-primary", create: realProvider },
      { name: "appconfig-parity", create: realProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(8);
  });

  it("passes the unmodified shared contract suite across the real adapter and the mock", async () => {
    const report = await assertProviderContractParity(configProviderContract, [
      { name: "appconfig-real", create: realProvider },
      { name: "appconfig-mock", create: equivalentMockProvider },
    ]);

    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(8);
  });
});
