import type { BlackboardHandlerClient } from "../../grpc/blackboard-client";
import type { NodeExecutionHandler } from "../../grpc/nodeexec-client";

export interface ExecuteNodeActivityInput {
  readonly tenantId: string; // ten_ prefixed UUIDv7
  readonly runId: string; // run_ prefixed UUIDv7
  readonly nodeExecutionId: string; // node_ prefixed UUIDv7
  readonly nodeKey: string;
  readonly nodeType: string;
  readonly configJson: string;
  /** Direct upstream node keys -- their outputs are read from the Blackboard, not passed inline. */
  readonly predecessorKeys: readonly string[];
}

export interface ExecuteNodeActivityResult {
  readonly outputJson: string;
  readonly metadataJson: string;
}

export interface ExecutorActivities {
  executeNode(input: ExecuteNodeActivityInput): Promise<ExecuteNodeActivityResult>;
}

/**
 * All real I/O for the Executor happens here, never in the workflow file.
 *
 * Cross-node data flows through the Blackboard (EXEC-5/EXEC-7), not
 * through Temporal workflow memory: this activity reads each direct
 * predecessor's output from the Blackboard (parallel reads -- they're
 * independent of each other), dispatches to the Node Execution Service
 * (EXEC-6, which owns every handler dispatch decision -- no business
 * logic here), then writes its own output back to the Blackboard so
 * later nodes (possibly in a later wave, possibly a sibling in the same
 * wave that also depends on this node) can read it the same way.
 *
 * A missing predecessor value (not yet written, or genuinely absent) is
 * passed through as an empty object rather than failing the node --
 * matches NodeexecService's existing inputs_json contract, where an
 * unlisted upstream key simply means "no data from that node".
 */
export function createExecutorActivities(
  nodeExecutionClient: NodeExecutionHandler,
  blackboardClient: BlackboardHandlerClient,
): ExecutorActivities {
  return {
    async executeNode(input: ExecuteNodeActivityInput): Promise<ExecuteNodeActivityResult> {
      const inputs: Record<string, Record<string, unknown>> = {};
      await Promise.all(
        input.predecessorKeys.map(async (predecessorKey) => {
          const read = await blackboardClient.readValue({
            tenant_id: input.tenantId,
            run_id: input.runId,
            key: predecessorKey,
          });
          if (read.found) {
            inputs[predecessorKey] = JSON.parse(read.value_json) as Record<
              string,
              unknown
            >;
          }
        }),
      );

      const response = await nodeExecutionClient.executeNode({
        tenant_id: input.tenantId,
        run_id: input.runId,
        node_execution_id: input.nodeExecutionId,
        node_key: input.nodeKey,
        node_type: input.nodeType,
        config_json: input.configJson,
        inputs_json: JSON.stringify(inputs),
      });

      await blackboardClient.writeValue({
        tenant_id: input.tenantId,
        run_id: input.runId,
        key: input.nodeKey,
        value_json: response.output_json,
      });

      return {
        outputJson: response.output_json,
        metadataJson: response.metadata_json,
      };
    },
  };
}
