import { describe, expect, it } from "vitest";

import { loadRecoveryEnvironment } from "./recovery-environment";

describe("Recovery Service environment", () => {
  it("uses isolated default port and accepts override", () => {
    expect(loadRecoveryEnvironment({}).grpcBindAddress).toBe("0.0.0.0:50058");
    expect(
      loadRecoveryEnvironment({
        RECOVERY_GRPC_BIND_ADDRESS: "127.0.0.1:51058",
      }).grpcBindAddress,
    ).toBe("127.0.0.1:51058");
  });

  it.each(["localhost:50058", "127.0.0.1:0", "127.0.0.1:70000"])(
    "rejects invalid address %s",
    (address) => {
      expect(() =>
        loadRecoveryEnvironment({ RECOVERY_GRPC_BIND_ADDRESS: address }),
      ).toThrow("Invalid Recovery Service environment");
    },
  );

  it("uses a default memoryServiceBaseUrl and accepts override", () => {
    expect(loadRecoveryEnvironment({}).memoryServiceBaseUrl).toBe(
      "http://localhost:8002",
    );
    expect(
      loadRecoveryEnvironment({
        MEMORY_SERVICE_BASE_URL: "http://memory-service.internal:9000",
      }).memoryServiceBaseUrl,
    ).toBe("http://memory-service.internal:9000");
  });

  it("rejects an invalid MEMORY_SERVICE_BASE_URL", () => {
    expect(() =>
      loadRecoveryEnvironment({ MEMORY_SERVICE_BASE_URL: "not a url" }),
    ).toThrow("MEMORY_SERVICE_BASE_URL must be a valid URL");
  });
});
