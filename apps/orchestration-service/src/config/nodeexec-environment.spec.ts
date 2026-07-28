import { describe, expect, it } from "vitest";

import {
  NodeexecConfigurationError,
  loadNodeexecEnvironment,
} from "./nodeexec-environment";

describe("loadNodeexecEnvironment", () => {
  it("loads the Tool Gateway address and default bind address", () => {
    expect(
      loadNodeexecEnvironment({ TOOL_GATEWAY_ADDRESS: "tool-gateway:50053" }),
    ).toEqual({
      grpcBindAddress: "0.0.0.0:50056",
      toolGatewayAddress: "tool-gateway:50053",
    });
  });

  it("fails startup when Tool Gateway address is missing", () => {
    expect(() => loadNodeexecEnvironment({})).toThrow(
      NodeexecConfigurationError,
    );
    expect(() => loadNodeexecEnvironment({})).toThrow(
      /TOOL_GATEWAY_ADDRESS/,
    );
  });
});
