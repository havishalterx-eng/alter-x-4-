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

  it("stages then promotes a model policy with service authentication", async () => {
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
    const body = {
      binding: {
        model_id: "anthropic.claude-sonnet-5",
        capability_tags: ["general", "reasoning"],
        fallback_chain: [{ provider: "openai", model_id: "gpt-5" }],
      },
      reason: "validated rollout",
    };

    const proposed = await controller.proposeModelPolicy(
      "STANDARD",
      body,
      "Bearer service-token",
    );
    await expect(store.getParameter("/policy")).rejects.toThrow("not found");
    await expect(store.getParameter("/policy/pending")).resolves.toBe(JSON.stringify(proposed));
    await expect(controller.promoteModelPolicy("Bearer service-token")).resolves.toEqual(proposed);
    await expect(store.getParameter("/policy")).resolves.toBe(JSON.stringify(proposed));
    await expect(store.getParameter("/policy/pending")).rejects.toThrow("not found");
  });
});
