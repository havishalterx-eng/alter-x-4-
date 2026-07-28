import type {
  SandboxExecuteRequest,
  SandboxExecuteResponse,
} from "@alterx/contracts";
import { SandboxGrpcValidationError } from "@alterx/adapters";

import { SandboxService } from "./sandbox.service";

const MAX_OUTPUT_BYTES = 64 * 1024;

/** Maps public gRPC request to service's intentionally single-command API. */
export class SandboxServiceGrpcHandler {
  constructor(
    private readonly sandboxService: Pick<SandboxService, "execute">,
  ) {}

  async execute(
    request: SandboxExecuteRequest,
  ): Promise<SandboxExecuteResponse> {
    requireValue(request.tenant_id, "tenant_id");
    requireValue(request.run_id, "run_id");
    requireValue(request.node_execution_id, "node_execution_id");
    requireValue(request.session_id, "session_id");
    requireValue(request.command, "command");
    if (request.arguments.length > 0) {
      throw new SandboxGrpcValidationError(
        "Sandbox Execute does not support command arguments",
      );
    }

    const result = await this.sandboxService.execute(
      request.session_id,
      request.command,
    );
    return {
      exit_code: result.exitCode,
      stdout_artifact_id: "",
      stderr_artifact_id: "",
      stdout: boundedOutput(result.stdout),
      stderr: boundedOutput(result.stderr),
    };
  }
}

function requireValue(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new SandboxGrpcValidationError(`${field} is required`);
  }
}

function boundedOutput(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= MAX_OUTPUT_BYTES) return value;
  return `${bytes.subarray(0, MAX_OUTPUT_BYTES).toString("utf8")}\n[output truncated]`;
}
