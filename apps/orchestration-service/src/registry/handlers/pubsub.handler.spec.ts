import { createMockQueueProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import { NodeHandlerValidationError } from "../handler";
import { PubSubHandler } from "./pubsub.handler";

describe("PubSubHandler", () => {
  it("has nodeType PubSub", () => {
    const handler = new PubSubHandler(createMockQueueProvider());
    expect(handler.nodeType).toBe("PubSub");
  });

  it("publishes upstream inputs to the declared topic by default", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const handler = new PubSubHandler(createMockQueueProvider({ publish }));

    const result = await handler.execute({
      config: { topic: "run.events" },
      inputs: { node_a: { status: "done" } },
    });

    expect(publish).toHaveBeenCalledWith("run.events", { node_a: { status: "done" } });
    expect(result.output).toEqual({ published: true, topic: "run.events" });
  });

  it("publishes config.payload instead of inputs when provided", async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const handler = new PubSubHandler(createMockQueueProvider({ publish }));

    await handler.execute({
      config: { topic: "run.events", payload: { custom: true } },
      inputs: { node_a: { status: "done" } },
    });

    expect(publish).toHaveBeenCalledWith("run.events", { custom: true });
  });

  it("rejects a missing topic", async () => {
    const handler = new PubSubHandler(createMockQueueProvider());

    await expect(
      handler.execute({ config: {}, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });
});
