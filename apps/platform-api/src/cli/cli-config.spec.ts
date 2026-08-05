import { TextEncoder } from "node:util";
import { describe, expect, it } from "vitest";
import { AppConfigCliConfigProvider } from "./cli-config";

describe("AppConfigCliConfigProvider", () => {
  it("reads version and rate-limit policy from AppConfig", async () => {
    const provider = new AppConfigCliConfigProvider(
      { applicationIdentifier: "app", environmentIdentifier: "env", configurationProfileIdentifier: "profile" },
      {
        send: async (command) =>
          commandName(command) === "StartConfigurationSessionCommand"
            ? { InitialConfigurationToken: "initial" }
            : {
                NextPollConfigurationToken: "next",
                Configuration: new TextEncoder().encode(JSON.stringify({
                  minimum_cli_version: "2.4.0",
                  device_flow_rate_limit_per_minute: 5,
                })),
              },
      },
    );
    await expect(provider.getCliPolicy()).resolves.toEqual({
      minimumCliVersion: "2.4.0",
      deviceFlowRateLimitPerMinute: 5,
    });
  });

  it("fails closed when AppConfig omits the CLI policy", async () => {
    const provider = new AppConfigCliConfigProvider(
      { applicationIdentifier: "app", environmentIdentifier: "env", configurationProfileIdentifier: "profile" },
      {
        send: async (command) =>
          commandName(command) === "StartConfigurationSessionCommand"
            ? { InitialConfigurationToken: "initial" }
            : { NextPollConfigurationToken: "next", Configuration: new Uint8Array() },
      },
    );
    await expect(provider.getCliPolicy()).rejects.toThrow("no CLI configuration");
  });
});

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}
