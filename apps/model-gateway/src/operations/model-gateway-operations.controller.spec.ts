import { HttpException } from "@nestjs/common";
import { FailoverModelProvider } from "@alterx/adapters";
import {
  createMockConfigProvider,
  createMockModelProvider,
  createMockMutableParameterStoreProvider,
} from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";
import { ModelGatewayOperationsController } from "./model-gateway-operations.controller";
import { OperationalConfigProvider } from "./operational-config-provider";

describe("ModelGatewayOperationsController", () => {
  it("requires service auth and updates actual provider control", async () => {
    const store = createMockMutableParameterStoreProvider();
    const providers = new FailoverModelProvider(
      createMockModelProvider({ providerId: "aws-bedrock" }),
      {},
      { store, parameterName: "/controls" },
    );
    const policy = new OperationalConfigProvider(
      createMockConfigProvider(),
      store,
      "/policy",
    );
    const controller = new ModelGatewayOperationsController(
      providers,
      policy,
      "service-token",
    );

    await expect(controller.listProviders("Bearer wrong-token"))
      .rejects.toBeInstanceOf(HttpException);
    await expect(controller.updateProvider(
      "aws-bedrock",
      { active: false, reason: "provider incident" },
      "Bearer service-token",
    )).resolves.toMatchObject({
      provider_id: "aws-bedrock",
      active: false,
    });
    await expect(controller.listProviders("Bearer service-token"))
      .resolves.toEqual([expect.objectContaining({ active: false })]);
  });

  it("rejects malformed writes before changing policy", async () => {
    const store = createMockMutableParameterStoreProvider();
    const controller = new ModelGatewayOperationsController(
      new FailoverModelProvider(
        createMockModelProvider({ providerId: "aws-bedrock" }),
        {},
        { store, parameterName: "/controls" },
      ),
      new OperationalConfigProvider(createMockConfigProvider(), store, "/policy"),
      "service-token",
    );

    expect(() => controller.updateModelPolicy(
      "UNKNOWN",
      { binding: {}, reason: "bad request" },
      "Bearer service-token",
    )).toThrow(HttpException);
  });
});
