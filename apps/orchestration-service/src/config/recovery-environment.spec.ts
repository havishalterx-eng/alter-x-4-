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
});
