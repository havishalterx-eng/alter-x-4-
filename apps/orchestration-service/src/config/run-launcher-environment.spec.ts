import { describe, expect, it } from "vitest";

import {
  RunLauncherConfigurationError,
  loadRunLauncherEnvironment,
} from "./run-launcher-environment";

const environment = {
  TEMPORAL_ADDRESS: "127.0.0.1:7233",
  TEMPORAL_NAMESPACE: "default",
  EXECUTOR_TASK_QUEUE: "executor",
  PROVISIONING_SERVICE_ADDRESS: "127.0.0.1:50055",
};

describe("loadRunLauncherEnvironment", () => {
  it("requires the Provisioning Service address used by project runs", () => {
    expect(loadRunLauncherEnvironment(environment)).toMatchObject({
      provisioningServiceAddress: "127.0.0.1:50055",
    });
    const withoutProvisioning: NodeJS.ProcessEnv = {
      ...environment,
      PROVISIONING_SERVICE_ADDRESS: undefined,
    };
    expect(() => loadRunLauncherEnvironment(withoutProvisioning)).toThrow(
      RunLauncherConfigurationError,
    );
  });
});
