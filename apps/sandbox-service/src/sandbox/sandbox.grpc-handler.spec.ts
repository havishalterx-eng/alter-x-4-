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

const artifacts = {
  createContent: vi.fn(async () => ({ artifact_id: "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ab", size_bytes: 2 })),
  readContent: vi.fn(async () => ({ content_type: "text/plain", content: new TextEncoder().encode("ok"), size_bytes: 2 })),
};

describe("SandboxServiceGrpcHandler", () => {
  it("returns bounded direct command output", async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    const handler = new SandboxServiceGrpcHandler({ execute, readFile: vi.fn(), writeFiles: vi.fn() }, artifacts);

    await expect(handler.execute(request)).resolves.toEqual({
      exit_code: 0,
      stdout_artifact_id: "",
      stderr_artifact_id: "",
      stdout: "ok",
      stderr: "",
    });
  });

  it("rejects unsupported shell arguments", async () => {
    const handler = new SandboxServiceGrpcHandler({ execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn() }, artifacts);

    await expect(
      handler.execute({ ...request, arguments: ["--unsafe"] }),
    ).rejects.toThrow("does not support command arguments");
  });

  it("stores a read file as a real artifact", async () => {
    const readFile = vi.fn(async () => "ok");
    const handler = new SandboxServiceGrpcHandler({ execute: vi.fn(), readFile, writeFiles: vi.fn() }, artifacts);
    await expect(handler.readFile({ tenant_id: request.tenant_id, run_id: request.run_id, session_id: request.session_id, path: "/workspace/index.ts" })).resolves.toEqual({ content_artifact_id: "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ab", size_bytes: 2 });
    expect(artifacts.createContent).toHaveBeenCalled();
  });

  it("resolves an artifact before writing a sandbox file", async () => {
    const writeFiles = vi.fn();
    const handler = new SandboxServiceGrpcHandler({ execute: vi.fn(), readFile: vi.fn(), writeFiles }, artifacts);
    await expect(handler.writeFile({ tenant_id: request.tenant_id, run_id: request.run_id, session_id: request.session_id, path: "/workspace/index.ts", content_artifact_id: "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ab" })).resolves.toEqual({ written: true, size_bytes: 2 });
    expect(writeFiles).toHaveBeenCalledWith(request.session_id, [{ path: "/workspace/index.ts", content: "ok" }]);
  });
});
