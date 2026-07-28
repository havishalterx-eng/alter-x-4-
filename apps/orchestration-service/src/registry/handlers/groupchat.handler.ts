import type { NodeType } from "@alterx/contracts";

import {
  NodeHandlerValidationError,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeHandler,
} from "../handler";

interface GroupChatTurn {
  readonly participant: string;
  readonly message: unknown;
}

/**
 * GroupChat: assembles the turn sequence for config.participants, in
 * declared order, pulling each participant's message from that
 * participant's upstream node output if one exists.
 *
 * This does not orchestrate a real multi-agent conversation yet -- there
 * is no LLM-driven turn-taking here, only deterministic sequencing and
 * pass-through of whatever upstream data already exists per participant.
 * Real orchestration needs the Model Gateway, which this ticket does not
 * wire in (Execution phase's later tickets do).
 */
export class GroupChatHandler implements NodeHandler {
  readonly nodeType: NodeType = "GroupChat";

  async execute(context: NodeExecutionContext): Promise<NodeExecutionResult> {
    const participants = context.config["participants"];
    if (
      !Array.isArray(participants) ||
      participants.length === 0 ||
      !participants.every((p) => typeof p === "string" && p.trim().length > 0)
    ) {
      throw new NodeHandlerValidationError(
        "GroupChat requires a non-empty config.participants array of strings",
      );
    }

    const transcript: GroupChatTurn[] = participants.map((participant: string) => ({
      participant,
      message: context.inputs[participant]?.["message"] ?? null,
    }));

    return { output: { transcript } };
  }
}
