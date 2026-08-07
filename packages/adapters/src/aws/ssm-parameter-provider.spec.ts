import { GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { createMockParameterStoreProvider, parameterStoreProviderContract, runProviderContractTests } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { AwsSsmParameterProvider, type SsmParameterCommandClient } from "./ssm-parameter-provider";

describe("AwsSsmParameterProvider", () => {
  it("resolves a parameter value without exposing it", async () => {
    const send = vi.fn(async (command: GetParameterCommand) => {
      expect(command.input.Name).toBe("/alter/prod/orchestration/artifacts-bucket");
      return { Parameter: { Value: "alter-prod-artifacts" } };
    });
    const provider = new AwsSsmParameterProvider({ region: "ap-south-1" }, { send } as SsmParameterCommandClient);
    await expect(provider.getParameter("/alter/prod/orchestration/artifacts-bucket")).resolves.toBe("alter-prod-artifacts");
    await expect(provider.getParameter(" bad ")).rejects.toThrow("Parameter name");
  });

  it("passes the shared parameter-store contract", async () => {
    const provider = new AwsSsmParameterProvider(
      { region: "ap-south-1" },
      { send: vi.fn(async (command: GetParameterCommand) => command.input.Name === "/contract/parameter" ? { Parameter: { Value: "contract-value" } } : {} ) } as SsmParameterCommandClient,
    );
    await expect(runProviderContractTests(parameterStoreProviderContract, [
      { name: "aws-ssm", create: () => provider },
      { name: "mock", create: () => createMockParameterStoreProvider() },
    ])).resolves.toMatchObject({ passed: true });
  });

  it("writes one disclosed String parameter with overwrite enabled", async () => {
    const send = vi.fn(async (command: GetParameterCommand | PutParameterCommand) => {
      expect(command).toBeInstanceOf(PutParameterCommand);
      expect(command.input).toEqual({
        Name: "/alter/prod/model-gateway/provider-controls",
        Value: '{"active":true}',
        Type: "String",
        Overwrite: true,
      });
      return {};
    });
    const provider = new AwsSsmParameterProvider(
      { region: "ap-south-1" },
      { send } as SsmParameterCommandClient,
    );

    await provider.putParameter(
      "/alter/prod/model-gateway/provider-controls",
      '{"active":true}',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
