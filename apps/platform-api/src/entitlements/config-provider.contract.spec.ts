import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppConfigConfigProvider } from "./adapters/appconfig/appconfig-config-provider";
import { LocalFileConfigProvider } from "./adapters/local-file/local-file-config-provider";
import { parseConfigDocument } from "./config-document";
import type { ConfigProvider } from "./config-provider.interface";

const expectedFree = {
  maxWorkflows: 3,
  maxProjects: 1,
  maxRunsPerDay: 10,
  maxConcurrentRuns: 1,
  maxSandboxMinutesPerMonth: 30,
  maxAdsStorageMb: 500,
  maxIntegrations: 3,
};

const configDocument = {
  plans: { free: expectedFree },
  abuse: {
    tenantRequestsPerMinute: 120,
    userRequestsPerMinute: 60,
    verificationScoreThreshold: 50,
    purchasesPerDay: 10,
    purchaseAmountPerDay: 1000,
  },
};

function runContract(name: string, createProvider: () => ConfigProvider): void {
  describe(`${name} ConfigProvider contract`, () => {
    it("returns exact free-tier defaults and abuse thresholds", async () => {
      const provider = createProvider();
      await expect(provider.getEntitlementDefaults("free")).resolves.toEqual(
        expectedFree,
      );
      await expect(provider.getAbuseThresholds()).resolves.toEqual(
        configDocument.abuse,
      );
    });

    it("rejects an unknown plan", async () => {
      await expect(
        createProvider().getEntitlementDefaults("enterprise-missing"),
      ).rejects.toThrow("No entitlement defaults configured");
    });
  });
}

runContract("local-file", () => new LocalFileConfigProvider());

runContract("AppConfig", () => {
  const bytes = new TextEncoder().encode(JSON.stringify(configDocument));
  const client = {
    send: async (command: unknown) =>
      command?.constructor.name === "StartConfigurationSessionCommand"
        ? { InitialConfigurationToken: "initial-token" }
        : {
            NextPollConfigurationToken: "next-token",
            Configuration: bytes,
          },
  };
  return new AppConfigConfigProvider(
    {
      applicationIdentifier: "app",
      environmentIdentifier: "test",
      configurationProfileIdentifier: "entitlements",
    },
    client,
  );
});

describe("LocalFileConfigProvider", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("reads each request so config changes need no deploy", async () => {
    directory = await mkdtemp(join(tmpdir(), "alterx-entitlements-"));
    const path = join(directory, "limits.json");
    const original = JSON.parse(
      await readFile(resolve(
        process.cwd(),
        "apps/platform-api/src/entitlements/adapters/local-file/default-limits.json",
      ), "utf8"),
    ) as typeof configDocument;
    await writeFile(path, JSON.stringify(original));
    const provider = new LocalFileConfigProvider(path);

    expect((await provider.getEntitlementDefaults("free")).maxWorkflows).toBe(3);
    original.plans.free.maxWorkflows = 9;
    await writeFile(path, JSON.stringify(original));
    expect((await provider.getEntitlementDefaults("free")).maxWorkflows).toBe(9);
  });
});

describe("entitlement config validation", () => {
  it("rejects non-object and missing-plan documents", () => {
    expect(() => parseConfigDocument("null")).toThrow(
      "Entitlement config must be an object",
    );
    expect(() => parseConfigDocument(JSON.stringify({ abuse: {} }))).toThrow(
      "Entitlement config plans must be an object",
    );
  });

  it("rejects invalid limits and missing abuse thresholds", () => {
    expect(() =>
      parseConfigDocument(
        JSON.stringify({
          ...configDocument,
          plans: { free: { ...expectedFree, maxWorkflows: -1 } },
        }),
      ),
    ).toThrow("plans.free.maxWorkflows must be a non-negative number");
    expect(() =>
      parseConfigDocument(JSON.stringify({ plans: configDocument.plans })),
    ).toThrow("abuse must be an object");
  });
});

describe("AppConfigConfigProvider polling", () => {
  it("keeps cached config when a later poll has no payload", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(configDocument));
    let polls = 0;
    const provider = new AppConfigConfigProvider(
      {
        applicationIdentifier: "app",
        environmentIdentifier: "test",
        configurationProfileIdentifier: "profile",
      },
      {
        send: async (command: unknown) => {
          if (command?.constructor.name === "StartConfigurationSessionCommand") {
            return { InitialConfigurationToken: "one" };
          }
          polls += 1;
          return {
            NextPollConfigurationToken: `token-${polls}`,
            Configuration: polls === 1 ? bytes : new Uint8Array(),
          };
        },
      },
    );

    await expect(provider.getEntitlementDefaults("free")).resolves.toEqual(
      expectedFree,
    );
    await expect(provider.getEntitlementDefaults("free")).resolves.toEqual(
      expectedFree,
    );
  });
});
