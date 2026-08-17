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

const createContent: (request: {
  readonly content: Uint8Array;
}) => Promise<{ readonly artifact_id: string; readonly size_bytes: number }> = async () => ({
  artifact_id: "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  size_bytes: 2,
});

const artifacts = {
  createContent: vi.fn(createContent),
  readContent: vi.fn(async () => ({ content_type: "text/plain", content: new TextEncoder().encode("ok"), size_bytes: 2 })),
};

describe("SandboxServiceGrpcHandler", () => {
  it("returns bounded direct command output", async () => {
    const execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    const handler = new SandboxServiceGrpcHandler({ execute, readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession: vi.fn() }, artifacts);

    await expect(handler.execute(request)).resolves.toEqual({
      exit_code: 0,
      stdout_artifact_id: "",
      stderr_artifact_id: "",
      stdout: "ok",
      stderr: "",
    });
  });

  it("rejects unsupported shell arguments", async () => {
    const handler = new SandboxServiceGrpcHandler({ execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession: vi.fn() }, artifacts);

    await expect(
      handler.execute({ ...request, arguments: ["--unsafe"] }),
    ).rejects.toThrow("does not support command arguments");
  });

  it("stores a read file as a real artifact", async () => {
    const readFile = vi.fn(async () => "ok");
    const handler = new SandboxServiceGrpcHandler({ execute: vi.fn(), readFile, writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession: vi.fn() }, artifacts);
    await expect(handler.readFile({ tenant_id: request.tenant_id, run_id: request.run_id, session_id: request.session_id, path: "/workspace/index.ts" })).resolves.toEqual({ content_artifact_id: "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ab", size_bytes: 2 });
    expect(artifacts.createContent).toHaveBeenCalled();
  });

  it("resolves an artifact before writing a sandbox file", async () => {
    const writeFiles = vi.fn();
    const handler = new SandboxServiceGrpcHandler({ execute: vi.fn(), readFile: vi.fn(), writeFiles, verifyBuild: vi.fn(), closeSession: vi.fn(), createSession: vi.fn() }, artifacts);
    await expect(handler.writeFile({ tenant_id: request.tenant_id, run_id: request.run_id, session_id: request.session_id, path: "/workspace/index.ts", content_artifact_id: "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ab" })).resolves.toEqual({ written: true, size_bytes: 2 });
    expect(writeFiles).toHaveBeenCalledWith(request.session_id, [{ path: "/workspace/index.ts", content: "ok" }]);
  });

  it("runs the build check and reports it in the persisted artifact", async () => {
    const verifyBuild = vi.fn(async () => ({
      output: { verification: { kind: "build" as const, status: "passed" as const } },
      metadata: {},
    }));
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild, closeSession: vi.fn(), createSession: vi.fn() },
      artifacts,
    );

    await expect(
      handler.runVerificationSuite({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_execution_id: request.node_execution_id,
        session_id: request.session_id,
        checks: ["build"],
      }),
    ).resolves.toEqual({
      passed: true,
      report_artifact_id: "art_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
    });
    expect(verifyBuild).toHaveBeenCalledWith(request.session_id);
    expect(artifacts.createContent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        content_type: "application/json",
      }),
    );
  });

  it("reports a real build failure as not passed", async () => {
    const verifyBuild = vi.fn(async () => ({
      output: { verification: { kind: "build" as const, status: "logic_failure" as const, errorCode: "SANDBOX_BUILD_LOGIC_FAILURE" } },
      metadata: {},
    }));
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild, closeSession: vi.fn(), createSession: vi.fn() },
      artifacts,
    );

    await expect(
      handler.runVerificationSuite({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_execution_id: request.node_execution_id,
        session_id: request.session_id,
        checks: ["build"],
      }),
    ).resolves.toMatchObject({ passed: false });
  });

  it("honestly reports an unsupported check instead of faking it, and never fabricates an overall pass", async () => {
    const verifyBuild = vi.fn(async () => ({
      output: { verification: { kind: "build" as const, status: "passed" as const } },
      metadata: {},
    }));
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild, closeSession: vi.fn(), createSession: vi.fn() },
      artifacts,
    );

    const result = await handler.runVerificationSuite({
      tenant_id: request.tenant_id,
      run_id: request.run_id,
      node_execution_id: request.node_execution_id,
      session_id: request.session_id,
      checks: ["build", "render"],
    });
    expect(result.passed).toBe(false);
    expect(verifyBuild).toHaveBeenCalledOnce();
    const lastCall = artifacts.createContent.mock.calls.at(-1);
    if (lastCall === undefined) throw new Error("createContent was not called");
    const report = JSON.parse(new TextDecoder().decode(lastCall[0].content));
    expect(report.build.status).toBe("passed");
    expect(report.render.status).toBe("unsupported");
  });

  it("rejects a request with zero checks", async () => {
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession: vi.fn() },
      artifacts,
    );

    await expect(
      handler.runVerificationSuite({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        node_execution_id: request.node_execution_id,
        session_id: request.session_id,
        checks: [],
      }),
    ).rejects.toThrow("at least one check");
  });

  it("closes a real session and reports it closed", async () => {
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession, createSession: vi.fn() },
      artifacts,
    );

    await expect(
      handler.closeSession({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        session_id: request.session_id,
      }),
    ).resolves.toEqual({ closed: true });
    expect(closeSession).toHaveBeenCalledWith(request.session_id);
  });

  it("rejects a close request missing session_id", async () => {
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession: vi.fn() },
      artifacts,
    );

    await expect(
      handler.closeSession({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        session_id: "",
      }),
    ).rejects.toThrow("session_id is required");
  });

  it("creates a real session, forwards the explicit template_id, and echoes it back", async () => {
    const createSession = vi.fn().mockResolvedValue({
      sessionId: "ses_mock-1",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession },
      artifacts,
    );

    await expect(
      handler.createSession({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        environment_json: JSON.stringify({ NODE_ENV: "test" }),
        template_id: "node",
      }),
    ).resolves.toEqual({
      session_id: "ses_mock-1",
      expires_at: "2026-01-01T00:00:00.000Z",
      template_id: "node",
    });
    expect(createSession).toHaveBeenCalledWith({
      tenantId: request.tenant_id,
      runId: request.run_id,
      templateId: "node",
      environment: { NODE_ENV: "test" },
    });
  });

  it("rejects a create-session request missing template_id", async () => {
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession: vi.fn() },
      artifacts,
    );

    await expect(
      handler.createSession({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        environment_json: "{}",
        template_id: "",
      }),
    ).rejects.toThrow("template_id is required");
  });

  it("rejects malformed environment_json before reaching the provider", async () => {
    const createSession = vi.fn();
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession },
      artifacts,
    );

    await expect(
      handler.createSession({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        environment_json: "not json",
        template_id: "node",
      }),
    ).rejects.toThrow("environment_json must be valid JSON");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects environment_json with a non-string value", async () => {
    const handler = new SandboxServiceGrpcHandler(
      { execute: vi.fn(), readFile: vi.fn(), writeFiles: vi.fn(), verifyBuild: vi.fn(), closeSession: vi.fn(), createSession: vi.fn() },
      artifacts,
    );

    await expect(
      handler.createSession({
        tenant_id: request.tenant_id,
        run_id: request.run_id,
        environment_json: JSON.stringify({ PORT: 3000 }),
        template_id: "node",
      }),
    ).rejects.toThrow("environment_json.PORT must be a string");
  });
});
