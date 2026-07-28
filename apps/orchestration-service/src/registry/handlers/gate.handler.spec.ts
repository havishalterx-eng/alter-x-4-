import { describe, expect, it } from "vitest";

import { NodeHandlerValidationError } from "../handler";
import { GateHandler } from "./gate.handler";

describe("GateHandler", () => {
  it("has nodeType Gate", () => {
    expect(new GateHandler().nodeType).toBe("Gate");
  });

  it("reports active successors whose condition evaluates true", async () => {
    const handler = new GateHandler();

    const result = await handler.execute({
      config: {
        conditions: {
          node_success: "inputs.check.status == 'ok'",
          node_failure: "inputs.check.status != 'ok'",
        },
      },
      inputs: { check: { status: "ok" } },
    });

    expect(result.output).toEqual({
      activeSuccessors: ["node_success"],
      evaluations: { node_success: true, node_failure: false },
    });
  });

  it("rejects a missing config.conditions", async () => {
    const handler = new GateHandler();

    await expect(
      handler.execute({ config: {}, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects a non-string condition", async () => {
    const handler = new GateHandler();

    await expect(
      handler.execute({
        config: { conditions: { node_a: 123 } },
        inputs: {},
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects an invalid CEL-subset expression", async () => {
    const handler = new GateHandler();

    await expect(
      handler.execute({
        config: { conditions: { node_a: "inputs.a == @weird" } },
        inputs: {},
      }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("can activate multiple successors at once", async () => {
    const handler = new GateHandler();

    const result = await handler.execute({
      config: {
        conditions: { node_a: "true", node_b: "true" },
      },
      inputs: {},
    });

    expect(result.output["activeSuccessors"]).toEqual(["node_a", "node_b"]);
  });
});
