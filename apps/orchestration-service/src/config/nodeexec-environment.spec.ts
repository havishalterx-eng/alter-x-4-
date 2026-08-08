import { describe, expect, it } from "vitest";

import {
  NodeexecConfigurationError,
  loadNodeexecEnvironment,
} from "./nodeexec-environment";

describe("loadNodeexecEnvironment", () => {
  it("loads the Tool Gateway address and default bind address", () => {
    expect(
      loadNodeexecEnvironment({
        TOOL_GATEWAY_ADDRESS: "tool-gateway:50053",
        SANDBOX_SERVICE_ADDRESS: "sandbox-service:50057",
        VERIFY_SERVICE_ADDRESS: "verification-service:50054",
      }),
    ).toEqual({
      grpcBindAddress: "0.0.0.0:50056",
      toolGatewayAddress: "tool-gateway:50053",
      sandboxServiceAddress: "sandbox-service:50057",
      verifyServiceAddress: "verification-service:50054",
    });
  });

  it("fails startup when Tool Gateway address is missing", () => {
    expect(() => loadNodeexecEnvironment({})).toThrow(
      NodeexecConfigurationError,
    );
    expect(() => loadNodeexecEnvironment({})).toThrow(
      /TOOL_GATEWAY_ADDRESS/,
    );
    expect(() =>
      loadNodeexecEnvironment({ TOOL_GATEWAY_ADDRESS: "tool-gateway:50053" }),
    ).toThrow(/SANDBOX_SERVICE_ADDRESS/);
    expect(() =>
      loadNodeexecEnvironment({
        TOOL_GATEWAY_ADDRESS: "tool-gateway:50053",
        SANDBOX_SERVICE_ADDRESS: "sandbox-service:50057",
      }),
    ).toThrow(/VERIFY_SERVICE_ADDRESS/);
  });
});
