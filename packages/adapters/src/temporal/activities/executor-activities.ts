import type { NodeExecutionHandler } from "../../grpc/nodeexec-client";

export interface ExecuteNodeActivityInput {
  readonly tenantId: string; // ten_ prefixed UUIDv7
  readonly runId: string; // run_ prefixed UUIDv7
  readonly nodeExecutionId: string; // node_ prefixed UUIDv7
  readonly nodeKey: string;
  readonly nodeType: string;
  readonly configJson: string;
  readonly inputsJson: string;
}

export interface ExecuteNodeActivityResult {
  readonly outputJson: string;
  readonly metadataJson: string;
}

export interface ExecutorActivities {
  executeNode(input: ExecuteNodeActivityInput): Promise<ExecuteNodeActivityResult>;
}

/**
 * All real I/O for the Executor happens here, never in the workflow file --
 * this activity is a thin proxy to the Node Execution Service (see
 * apps/orchestration-service/src/registry/nodeexec.service.ts), which owns
 * every handler dispatch decision. No business logic lives in this
 * package; that's what keeps executor-workflow.ts deterministic.
 */
export function createExecutorActivities(
  client: NodeExecutionHandler,
): ExecutorActivities {
  return {
    async executeNode(input: ExecuteNodeActivityInput): Promise<ExecuteNodeActivityResult> {
      const response = await client.executeNode({
        tenant_id: input.tenantId,
        run_id: input.runId,
        node_execution_id: input.nodeExecutionId,
        node_key: input.nodeKey,
        node_type: input.nodeType,
        config_json: input.configJson,
        inputs_json: input.inputsJson,
      });
      return {
        outputJson: response.output_json,
        metadataJson: response.metadata_json,
      };
    },
  };
}
