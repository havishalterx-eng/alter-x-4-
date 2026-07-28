import { describe, expect, it } from "vitest";

import { MergeHandler } from "./merge.handler";

describe("MergeHandler", () => {
  it("has nodeType Merge", () => {
    expect(new MergeHandler().nodeType).toBe("Merge");
  });

  it("merges every upstream output into one object", async () => {
    const handler = new MergeHandler();

    const result = await handler.execute({
      config: {},
      inputs: {
        node_a: { x: 1 },
        node_b: { y: 2 },
      },
    });

    expect(result.output).toEqual({ x: 1, y: 2 });
  });

  it("resolves key collisions by ascending upstream node key", async () => {
    const handler = new MergeHandler();

    const result = await handler.execute({
      config: {},
      inputs: {
        node_a: { shared: "from-a" },
        node_z: { shared: "from-z" },
      },
    });

    expect(result.output).toEqual({ shared: "from-z" });
  });

  it("returns an empty object for no upstream inputs", async () => {
    const handler = new MergeHandler();

    const result = await handler.execute({ config: {}, inputs: {} });

    expect(result.output).toEqual({});
  });
});
