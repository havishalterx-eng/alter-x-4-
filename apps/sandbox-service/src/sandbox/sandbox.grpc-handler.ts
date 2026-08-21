import { randomUUID } from "node:crypto";
import type {
  SandboxCloseSessionRequest,
  SandboxCloseSessionResponse,
  SandboxCreateSessionRequest,
  SandboxCreateSessionResponse,
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
    private readonly sandboxService: Pick<SandboxService, "execute" | "readFile" | "writeFiles" | "verifyBuild" | "verifyRender" | "closeSession" | "createSession">,
    private readonly artifacts: ArtifactContentClientHandler,
  ) {}

  async createSession(
    request: SandboxCreateSessionRequest,
  ): Promise<SandboxCreateSessionResponse> {
    requireValue(request.tenant_id, "tenant_id");
    requireValue(request.run_id, "run_id");
    requireValue(request.template_id, "template_id");
    const environment = parseEnvironmentJson(request.environment_json);
    const session = await this.sandboxService.createSession({
      tenantId: request.tenant_id,
      runId: request.run_id,
      templateId: request.template_id,
      environment,
    });
    return {
      session_id: session.sessionId,
      expires_at: session.expiresAt,
      template_id: request.template_id,
    };
  }

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
      } else if (check === "render") {
        if (!request.preview_url) {
          report[check] = {
            status: "logic_failure",
            detail: 'check "render" requires preview_url',
          };
          passed = false;
          continue;
        }
        const files = await Promise.all(
          request.render_files.map(async (file) => {
            const artifact = await this.artifacts.readContent({
              tenant_id: request.tenant_id,
              artifact_id: file.content_artifact_id,
            });
            return { path: file.path, content: new TextDecoder().decode(artifact.content) };
          }),
        );
        const result = await this.sandboxService.verifyRender(
          {
            tenantId: request.tenant_id,
            runId: request.run_id,
            nodeExecutionId: request.node_execution_id,
            requestId: `req_${randomUUID()}`,
            traceId: `trc_${randomUUID()}`,
          },
          request.preview_url,
          files,
        );
        report[check] = result.output.verification;
        if (result.output.verification.status !== "passed") passed = false;
      } else {
        report[check] = {
          status: "unsupported",
          detail: `check "${check}" has no real RunVerificationSuite dispatch -- only "build"/"render" are wired today`,
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

  async closeSession(
    request: SandboxCloseSessionRequest,
  ): Promise<SandboxCloseSessionResponse> {
    requireValue(request.tenant_id, "tenant_id");
    requireValue(request.run_id, "run_id");
    requireValue(request.session_id, "session_id");
    await this.sandboxService.closeSession(request.session_id);
    return { closed: true };
  }
}

function requireValue(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new SandboxGrpcValidationError(`${field} is required`);
  }
}

function parseEnvironmentJson(environmentJson: string): Readonly<Record<string, string>> {
  if (environmentJson.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(environmentJson);
  } catch {
    throw new SandboxGrpcValidationError("environment_json must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SandboxGrpcValidationError("environment_json must decode to a JSON object");
  }
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new SandboxGrpcValidationError(
        `environment_json.${key} must be a string`,
      );
    }
    environment[key] = value;
  }
  return environment;
}

function boundedOutput(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= MAX_OUTPUT_BYTES) return value;
  return `${bytes.subarray(0, MAX_OUTPUT_BYTES).toString("utf8")}\n[output truncated]`;
}
