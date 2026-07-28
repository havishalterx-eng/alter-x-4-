import { describe, expect, it } from "vitest";

import { MergeHandler } from "./handlers/merge.handler";
import {
  NodeHandlerRegistry,
  NodeTypeNotImplementedError,
  UnknownNodeTypeError,
} from "./node-handler-registry";

describe("NodeHandlerRegistry", () => {
  it("dispatches to the registered handler for a known, implemented type", async () => {
    const registry = new NodeHandlerRegistry([new MergeHandler()]);

    const result = await registry.execute("Merge", {
      config: {},
      inputs: { node_a: { x: 1 } },
    });

    expect(result.output).toEqual({ x: 1 });
  });

  it("throws NodeTypeNotImplementedError for a known but unregistered type", async () => {
    const registry = new NodeHandlerRegistry([new MergeHandler()]);

    await expect(
      registry.execute("Synthesis", { config: {}, inputs: {} }),
    ).rejects.toThrow(NodeTypeNotImplementedError);
  });

  it("throws UnknownNodeTypeError for a type outside the 11-type vocabulary", async () => {
    const registry = new NodeHandlerRegistry([new MergeHandler()]);

    await expect(
      registry.execute("NotAType", { config: {}, inputs: {} }),
    ).rejects.toThrow(UnknownNodeTypeError);
  });
});
