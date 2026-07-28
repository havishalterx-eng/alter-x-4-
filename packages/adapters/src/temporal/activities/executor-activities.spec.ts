import { describe, expect, it, vi } from "vitest";

import type { NodeexecExecuteNodeRequest } from "@alterx/contracts";

import { createExecutorActivities } from "./executor-activities";

describe("createExecutorActivities", () => {
  it("proxies executeNode to the client with mapped field names", async () => {
    const executeNode = vi.fn(async (request: NodeexecExecuteNodeRequest) => ({
      output_json: JSON.stringify({ echo: request.node_key }),
      metadata_json: "{}",
    }));
    const activities = createExecutorActivities({ executeNode });

    const result = await activities.executeNode({
      tenantId: "ten_test",
      runId: "run_test",
      nodeExecutionId: "node_test",
      nodeKey: "node_a",
      nodeType: "Merge",
      configJson: "{}",
      inputsJson: "{}",
    });

    expect(executeNode).toHaveBeenCalledWith({
      tenant_id: "ten_test",
      run_id: "run_test",
      node_execution_id: "node_test",
      node_key: "node_a",
      node_type: "Merge",
      config_json: "{}",
      inputs_json: "{}",
    });
    expect(result.outputJson).toBe(JSON.stringify({ echo: "node_a" }));
    expect(result.metadataJson).toBe("{}");
  });

  it("propagates a client error", async () => {
    const executeNode = vi.fn().mockRejectedValue(new Error("boom"));
    const activities = createExecutorActivities({ executeNode });

    await expect(
      activities.executeNode({
        tenantId: "ten_test",
        runId: "run_test",
        nodeExecutionId: "node_test",
        nodeKey: "node_a",
        nodeType: "Merge",
        configJson: "{}",
        inputsJson: "{}",
      }),
    ).rejects.toThrow("boom");
  });
});
