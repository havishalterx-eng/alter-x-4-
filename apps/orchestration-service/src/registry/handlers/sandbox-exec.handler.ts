import {
  NodeExecutionIdSchema,
  RunIdSchema,
  SandboxExecCompiledConfigSchema,
  TenantIdSchema,
  type NodeType,
} from "@alterx/contracts";
import {
  SandboxServiceClientError,
  type SandboxExecuteHandler,
} from "@alterx/adapters";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";

/** Dispatches configured commands only to Sandbox Service, never E2B directly. */
export class SandboxExecHandler implements NodeHandler {
  readonly nodeType: NodeType = "SandboxExec";

  constructor(private readonly sandboxService: SandboxExecuteHandler) {}

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const tenantId = requiredId(TenantIdSchema, context.tenant_id, "tenant_id");
    const runId = requiredId(RunIdSchema, context.run_id, "run_id");
    const nodeExecutionId = requiredId(
      NodeExecutionIdSchema,
      context.node_execution_id,
      "node_execution_id",
    );
    const config = SandboxExecCompiledConfigSchema.safeParse(context.config);
    if (!config.success || config.data.command === undefined) {
      throw new NodeHandlerValidationError(
        "SandboxExec requires non-empty config.command",
      );
    }
    const sessionId = config.data.sandbox_session_id;
    if (sessionId === undefined) {
      throw new NodeHandlerValidationError(
        "SandboxExec requires config.sandbox_session_id from Provisioning",
      );
    }
    if (
      context.sandbox_session_id !== undefined &&
      context.sandbox_session_id !== sessionId
    ) {
      throw new NodeHandlerValidationError(
        "SandboxExec execution context session does not match node config",
      );
    }

    try {
      const response = await this.sandboxService.execute({
        tenant_id: tenantId,
        run_id: runId,
        node_execution_id: nodeExecutionId,
        session_id: sessionId,
        command: config.data.command,
        arguments: [],
      });
      return {
        output: {
          exit_code: response.exit_code,
          stdout: response.stdout,
          stderr: response.stderr,
        },
      };
    } catch (error: unknown) {
      if (error instanceof SandboxServiceClientError) {
        throw new NodeHandlerValidationError(
          error.retryable
            ? "Sandbox Service is temporarily unavailable"
            : "Sandbox Service rejected execution",
        );
      }
      throw error;
    }
  }
}

function requiredId<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  value: unknown,
  field: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    throw new NodeHandlerValidationError(
      `SandboxExec requires valid ${field} on the execution context`,
    );
  }
  return result.data;
}
