import { describe, expect, it } from "vitest";

import {
  WorkflowLifecycleConfigurationError,
  loadWorkflowLifecycleEnvironment,
} from "./workflow-lifecycle-environment";

describe("loadWorkflowLifecycleEnvironment", () => {
  it("uses a dedicated default gRPC bind address", () => {
    expect(loadWorkflowLifecycleEnvironment({})).toEqual({
      grpcBindAddress: "0.0.0.0:50054",
    });
  });

  it("accepts an explicit valid address", () => {
    expect(
      loadWorkflowLifecycleEnvironment({
        DEPLOYCTL_GRPC_BIND_ADDRESS: "127.0.0.1:51054",
      }),
    ).toEqual({ grpcBindAddress: "127.0.0.1:51054" });
  });

  it.each(["localhost:50054", "127.0.0.1:0", "127.0.0.1:70000"])(
    "rejects invalid address %s",
    (value) => {
      expect(() =>
        loadWorkflowLifecycleEnvironment({
          DEPLOYCTL_GRPC_BIND_ADDRESS: value,
        }),
      ).toThrow(WorkflowLifecycleConfigurationError);
    },
  );
});
