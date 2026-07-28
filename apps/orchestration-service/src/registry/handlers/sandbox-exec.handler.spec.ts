import type {
  SandboxExecuteRequest,
  SandboxExecuteResponse,
} from "@alterx/contracts";
import type { SandboxExecuteHandler } from "@alterx/adapters";
import { describe, expect, it, vi } from "vitest";

import { NodeHandlerValidationError } from "../handler";
import { SandboxExecHandler } from "./sandbox-exec.handler";
import { MemoryWriteHandler } from "./memory-write.handler";
import { SynthesisHandler } from "./synthesis.handler";

const context = {
  config: {
    command: "pnpm test",
    sandbox_session_id: "e2b_ses_123",
  },
  inputs: {},
  tenant_id: "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  run_id: "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  node_execution_id: "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab",
  sandbox_session_id: "e2b_ses_123",
};

function sandbox(
  execute: (request: SandboxExecuteRequest) => Promise<SandboxExecuteResponse>,
): SandboxExecuteHandler {
  return { execute };
}

describe("SandboxExecHandler", () => {
  it("dispatches through Sandbox Service with configured session ID", async () => {
    const execute = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout_artifact_id: "",
      stderr_artifact_id: "",
      stdout: "ok",
      stderr: "",
    });
    const result = await new SandboxExecHandler(sandbox(execute)).execute(context);

    expect(execute).toHaveBeenCalledWith({
      tenant_id: context.tenant_id,
      run_id: context.run_id,
      node_execution_id: context.node_execution_id,
      session_id: "e2b_ses_123",
      command: "pnpm test",
      arguments: [],
    });
    expect(result).toEqual({
      output: { exit_code: 0, stdout: "ok", stderr: "" },
    });
  });

  it("fails closed when context session differs from compiled config", async () => {
    const handler = new SandboxExecHandler(sandbox(vi.fn()));

    await expect(
      handler.execute({ ...context, sandbox_session_id: "e2b_ses_other" }),
    ).rejects.toBeInstanceOf(NodeHandlerValidationError);
  });
});

describe("unimplemented execution handlers", () => {
  it.each([
    [new SynthesisHandler(), "synthesis_not_implemented", "Output"],
    [new MemoryWriteHandler(), "memory_write_not_implemented", "Knowledge"],
  ] as const)("returns honest non-success state for %s", async (handler, code, phase) => {
    await expect(handler.execute({ config: {}, inputs: {} })).resolves.toEqual({
      output: { stub: true, code, implementation_phase: phase },
      metadata: { execution_status: "not_implemented" },
    });
  });
});
