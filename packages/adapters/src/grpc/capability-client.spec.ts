import { describe, expect, it, vi } from "vitest";

import { CapabilityServiceClient } from "./capability-client";

const request = {
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  run_id: "run_018f47a5-7b2c-7d10-8f11-123456789abc",
  node_key: "summarise",
  node_type: "LLMTask",
  node_config_json: "{}",
};

describe("CapabilityServiceClient", () => {
  it("calls ResolveNodeRequirements and returns the response", async () => {
    const grpc = {
      resolveNodeRequirements: vi.fn((_request, _options, callback) =>
        callback(null, { node_requirements_json: "{}", schema_version: "v1" }),
      ),
    };
    const client = new CapabilityServiceClient(
      { address: "localhost:50061", protoPath: "unused" },
      grpc as never,
    );

    await expect(client.resolveNodeRequirements(request)).resolves.toEqual({
      node_requirements_json: "{}",
      schema_version: "v1",
    });
  });

  // ENGINE-FIX-P5-SEC-1: intelligence-service's capability gRPC interceptor
  // requires the internal service credential on every RPC.
  it("sends the configured internal service credential as authorization metadata", async () => {
    const grpc = {
      resolveNodeRequirements: vi.fn((_request, _options, callback) =>
        callback(null, { node_requirements_json: "{}", schema_version: "v1" }),
      ),
    };
    const client = new CapabilityServiceClient(
      { address: "localhost:50061", protoPath: "unused", authorization: "Bearer service-token" },
      grpc as never,
    );

    await client.resolveNodeRequirements(request);
    const options = (grpc.resolveNodeRequirements as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(options.metadata.get("authorization")).toEqual(["Bearer service-token"]);
  });
});
