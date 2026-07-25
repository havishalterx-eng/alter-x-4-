import { describe, expect, it } from "vitest";

import {
  ConversationManagerConfigurationError,
  loadConversationManagerEnvironment,
} from "./environment";

function environment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ALTER_ENV: "local",
    MODEL_GATEWAY_ADDRESS: "127.0.0.1:50051",
    ...overrides,
  };
}

describe("loadConversationManagerEnvironment", () => {
  it("validates and returns the documented local environment", () => {
    expect(loadConversationManagerEnvironment(environment())).toEqual({
      alterEnvironment: "local",
      modelGatewayAddress: "127.0.0.1:50051",
      grpcBindAddress: "0.0.0.0:50052",
    });
  });

  it("accepts a validated custom bind address", () => {
    expect(
      loadConversationManagerEnvironment(
        environment({ CONVERSATION_GRPC_BIND_ADDRESS: "127.0.0.1:51052" }),
      ),
    ).toMatchObject({ grpcBindAddress: "127.0.0.1:51052" });
  });

  it.each([
    ["ALTER_ENV", { ALTER_ENV: "qa" }],
    ["MODEL_GATEWAY_ADDRESS", { MODEL_GATEWAY_ADDRESS: "" }],
    [
      "CONVERSATION_GRPC_BIND_ADDRESS",
      { CONVERSATION_GRPC_BIND_ADDRESS: "localhost:50052" },
    ],
    [
      "CONVERSATION_GRPC_BIND_ADDRESS",
      { CONVERSATION_GRPC_BIND_ADDRESS: "127.0.0.1:70000" },
    ],
  ])("rejects invalid %s", (field, override) => {
    expect(() =>
      loadConversationManagerEnvironment(environment(override)),
    ).toThrow(ConversationManagerConfigurationError);
    expect(() =>
      loadConversationManagerEnvironment(environment(override)),
    ).toThrow(field);
  });
});
