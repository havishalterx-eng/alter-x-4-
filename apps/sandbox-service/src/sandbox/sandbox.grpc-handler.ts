import type {
  SandboxExecuteRequest,
  SandboxExecuteResponse,
  SandboxReadFileRequest,
  SandboxReadFileResponse,
  SandboxRunVerificationSuiteRequest,
  SandboxRunVerificationSuiteResponse,
  SandboxWriteFileRequest,
  SandboxWriteFileResponse,
} from "@alterx/contracts";
import { SandboxGrpcValidationError, type ArtifactContentClientHandler } from "@alterx/adapters";

import { SandboxService } from "./sandbox.service";

const MAX_OUTPUT_BYTES = 64 * 1024;

/** Maps public gRPC request to service's intentionally single-command API. */
export class SandboxServiceGrpcHandler {
  constructor(
    private readonly sandboxService: Pick<SandboxService, "execute" | "readFile" | "writeFiles" | "verifyBuild">,
    private readonly artifacts: ArtifactContentClientHandler,
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

  async readFile(request: SandboxReadFileRequest): Promise<SandboxReadFileResponse> {
    requireValue(request.tenant_id, "tenant_id"); requireValue(request.run_id, "run_id"); requireValue(request.session_id, "session_id"); requireValue(request.path, "path");
    const content = new TextEncoder().encode(await this.sandboxService.readFile(request.session_id, request.path));
    const artifact = await this.artifacts.createContent({ tenant_id: request.tenant_id, run_id: request.run_id, content_type: "application/octet-stream", content });
    return { content_artifact_id: artifact.artifact_id, size_bytes: artifact.size_bytes };
  }

  async writeFile(request: SandboxWriteFileRequest): Promise<SandboxWriteFileResponse> {
    requireValue(request.tenant_id, "tenant_id"); requireValue(request.run_id, "run_id"); requireValue(request.session_id, "session_id"); requireValue(request.path, "path"); requireValue(request.content_artifact_id, "content_artifact_id");
    const artifact = await this.artifacts.readContent({ tenant_id: request.tenant_id, artifact_id: request.content_artifact_id });
    const content = new TextDecoder().decode(artifact.content);
    await this.sandboxService.writeFiles(request.session_id, [{ path: request.path, content }]);
    return { written: true, size_bytes: artifact.size_bytes };
  }

  async runVerificationSuite(
    request: SandboxRunVerificationSuiteRequest,
  ): Promise<SandboxRunVerificationSuiteResponse> {
    requireValue(request.tenant_id, "tenant_id");
    requireValue(request.run_id, "run_id");
    requireValue(request.node_execution_id, "node_execution_id");
    requireValue(request.session_id, "session_id");
    if (request.checks.length === 0) {
      throw new SandboxGrpcValidationError(
        "RunVerificationSuite requires at least one check",
      );
    }

    const report: Record<string, unknown> = {};
    let passed = true;
    for (const check of request.checks) {
      if (check === "build") {
        const result = await this.sandboxService.verifyBuild(request.session_id);
        report[check] = result.output.verification;
        if (result.output.verification.status !== "passed") passed = false;
      } else {
        // "render" is a real, existing SandboxService capability
        // (verifyRender) but needs a previewUrl that
        // RunVerificationSuiteRequest's locked proto shape has no field
        // for -- honestly reported as unsupported here rather than
        // silently skipped or faked as passed.
        report[check] = {
          status: "unsupported",
          detail: `check "${check}" has no real RunVerificationSuite dispatch -- only "build" is wired today`,
        };
        passed = false;
      }
    }

    const artifact = await this.artifacts.createContent({
      tenant_id: request.tenant_id,
      run_id: request.run_id,
      content_type: "application/json",
      content: new TextEncoder().encode(JSON.stringify(report)),
    });
    return { passed, report_artifact_id: artifact.artifact_id };
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
