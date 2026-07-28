import { describe, expect, it } from "vitest";

import { NodeHandlerValidationError } from "../handler";
import { GroupChatHandler } from "./groupchat.handler";

describe("GroupChatHandler", () => {
  it("has nodeType GroupChat", () => {
    expect(new GroupChatHandler().nodeType).toBe("GroupChat");
  });

  it("assembles a turn per participant in declared order", async () => {
    const handler = new GroupChatHandler();

    const result = await handler.execute({
      config: { participants: ["alice", "bob"] },
      inputs: {
        alice: { message: "hi from alice" },
        bob: { message: "hi from bob" },
      },
    });

    expect(result.output).toEqual({
      transcript: [
        { participant: "alice", message: "hi from alice" },
        { participant: "bob", message: "hi from bob" },
      ],
    });
  });

  it("uses null when a participant has no upstream message", async () => {
    const handler = new GroupChatHandler();

    const result = await handler.execute({
      config: { participants: ["alice"] },
      inputs: {},
    });

    expect(result.output).toEqual({
      transcript: [{ participant: "alice", message: null }],
    });
  });

  it("rejects an empty participants list", async () => {
    const handler = new GroupChatHandler();

    await expect(
      handler.execute({ config: { participants: [] }, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects a non-array participants config", async () => {
    const handler = new GroupChatHandler();

    await expect(
      handler.execute({ config: { participants: "alice" }, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });

  it("rejects a non-string participant entry", async () => {
    const handler = new GroupChatHandler();

    await expect(
      handler.execute({ config: { participants: ["alice", 123] }, inputs: {} }),
    ).rejects.toThrow(NodeHandlerValidationError);
  });
});
