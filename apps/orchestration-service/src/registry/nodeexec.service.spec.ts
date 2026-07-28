import { describe, expect, it } from "vitest";

import { NodeHandlerValidationError } from "./handler";
import { MergeHandler } from "./handlers/merge.handler";
import { NodeHandlerRegistry } from "./node-handler-registry";
import { NodeexecService } from "./nodeexec.service";

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function service(): NodeexecService {
  return new NodeexecService(new NodeHandlerRegistry([new MergeHandler()]));
}

describe("NodeexecService.executeNode", () => {
  it("dispatches to the handler and returns JSON-serialized output/metadata", async () => {
    const response = await service().executeNode({
      tenant_id: TENANT_ID,
      run_id: RUN_ID,
      node_execution_id: NODE_EXECUTION_ID,
      node_key: "node_merge",
      node_type: "Merge",
      config_json: "{}",
      inputs_json: JSON.stringify({ node_a: { x: 1 } }),
    });

    expect(JSON.parse(response.output_json)).toEqual({ x: 1 });
    expect(JSON.parse(response.metadata_json)).toEqual({});
  });

  it("rejects a blank node_key", async () => {
    await expect(
      service().executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "",
        node_type: "Merge",
        config_json: "{}",
        inputs_json: "{}",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects malformed config_json", async () => {
    await expect(
      service().executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "node_merge",
        node_type: "Merge",
        config_json: "{not json",
        inputs_json: "{}",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects malformed inputs_json", async () => {
    await expect(
      service().executeNode({
        tenant_id: TENANT_ID,
        run_id: RUN_ID,
        node_execution_id: NODE_EXECUTION_ID,
        node_key: "node_merge",
        node_type: "Merge",
        config_json: "{}",
        inputs_json: "[1,2,3]",
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });
});
