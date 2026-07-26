import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";

import {
  AwsSecretsManagerProvider,
  type SecretsManagerCommandClient,
} from "./secrets-manager-provider";

describe("AwsSecretsManagerProvider", () => {
  it("resolves secret string by reference without logging value", async () => {
    const send = vi.fn(async (command: GetSecretValueCommand) => {
      expect(command.input.SecretId).toBe("/alter/prod/audit/database");
      return { SecretString: "postgresql://resolved-at-runtime" };
    });
    const destroy = vi.fn();
    const provider = new AwsSecretsManagerProvider(
      { region: "ap-south-1" },
      { send, destroy } as SecretsManagerCommandClient,
    );

    await expect(
      provider.getSecret("/alter/prod/audit/database"),
    ).resolves.toBe("postgresql://resolved-at-runtime");
    await expect(provider.healthCheck()).resolves.toMatchObject({
      status: "healthy",
    });
    provider.close();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("supports binary values and rejects invalid or empty resolution", async () => {
    const binaryClient: SecretsManagerCommandClient = {
      send: vi.fn(async () => ({
        SecretBinary: Buffer.from("postgresql://binary-runtime"),
      })),
    };
    const binaryProvider = new AwsSecretsManagerProvider(
      { region: "ap-south-1" },
      binaryClient,
    );
    await expect(binaryProvider.getSecret("audit/database")).resolves.toBe(
      "postgresql://binary-runtime",
    );
    await expect(binaryProvider.getSecret(" bad ")).rejects.toThrow(
      /reference ID/,
    );

    const emptyProvider = new AwsSecretsManagerProvider(
      { region: "ap-south-1" },
      { send: vi.fn(async () => ({})) },
    );
    await expect(emptyProvider.getSecret("audit/database")).rejects.toThrow(
      "Resolved secret contains no value",
    );
    expect(() => new AwsSecretsManagerProvider({ region: "" })).toThrow(
      /region is required/,
    );
  });

  it("creates, rotates, and deletes secrets without logging their value", async () => {
    const secret = "never-print-me";
    const send = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("exists"), {
          name: "ResourceExistsException",
        }),
      )
      .mockResolvedValue({});
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const provider = new AwsSecretsManagerProvider(
      { region: "ap-south-1" },
      { send } as SecretsManagerCommandClient,
    );

    await provider.putSecret("credential/ref", secret);
    await provider.deleteSecret("credential/ref");

    expect(send.mock.calls[0]![0]).toBeInstanceOf(CreateSecretCommand);
    expect(send.mock.calls[1]![0]).toBeInstanceOf(PutSecretValueCommand);
    expect(send.mock.calls[2]![0]).toBeInstanceOf(DeleteSecretCommand);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    log.mockRestore();
  });

  it("does not retry unexpected create failures", async () => {
    const send = vi.fn().mockRejectedValue(new Error("denied"));
    const provider = new AwsSecretsManagerProvider(
      { region: "ap-south-1" },
      { send } as SecretsManagerCommandClient,
    );
    await expect(provider.putSecret("credential/ref", "value")).rejects.toThrow(
      "denied",
    );
    await expect(provider.putSecret("credential/ref", "")).rejects.toThrow(
      "non-empty",
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
