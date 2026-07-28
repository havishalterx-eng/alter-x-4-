import { describe, expect, it, vi } from "vitest";

import { SandboxServiceGrpcHandler } from "./sandbox.grpc-handler";

const request = {
  tenant_id: "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  run_id: "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  node_execution_id: "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  session_id: "e2b_ses_123",
  command: "pnpm test",
  arguments: [],
};

describe("SandboxServiceGrpcHandler", () => {
  it("returns bounded direct command output", async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    const handler = new SandboxServiceGrpcHandler({ execute });

    await expect(handler.execute(request)).resolves.toEqual({
      exit_code: 0,
      stdout_artifact_id: "",
      stderr_artifact_id: "",
      stdout: "ok",
      stderr: "",
    });
  });

  it("rejects unsupported shell arguments", async () => {
    const handler = new SandboxServiceGrpcHandler({ execute: vi.fn() });

    await expect(
      handler.execute({ ...request, arguments: ["--unsafe"] }),
    ).rejects.toThrow("does not support command arguments");
  });
});
