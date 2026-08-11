import { describe, expect, it, vi } from "vitest";

import type { SandboxExecuteRequest, SandboxExecuteResponse } from "@alterx/contracts";
import { SandboxServiceClient } from "./sandbox-client";

const REQUEST: SandboxExecuteRequest = {
  tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
  run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
  node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
  session_id: "ses_018f47a2-7b11-7b11-8a11-1234567890ab",
  command: "echo ok",
  arguments: [],
};

describe("SandboxServiceClient", () => {
  it("propagates an acquired M2M token", async () => {
    const grpcClient = {
      execute: vi.fn(
        (_request: unknown, metadata: { get(key: string): readonly string[] }, _options: unknown, callback: (error: null, response: SandboxExecuteResponse) => void) => {
          expect(metadata.get("authorization")).toEqual(["Bearer signed-m2m-token"]);
          callback(null, {
            exit_code: 0,
            stdout_artifact_id: "",
            stderr_artifact_id: "",
            stdout: "ok",
            stderr: "",
          });
        },
      ),
    };
    const client = new SandboxServiceClient(
      {
        address: "localhost:50057",
        protoPath: "unused",
        accessTokenProvider: { getAccessToken: async () => "signed-m2m-token" },
      },
      grpcClient as never,
    );

    await expect(client.execute(REQUEST)).resolves.toMatchObject({ exit_code: 0 });
  });
});
