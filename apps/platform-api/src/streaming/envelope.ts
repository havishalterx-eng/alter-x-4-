import { SseEnvelopeSchema } from "@alterx/contracts";
import { z } from "zod";
import type { EngineSseMessage } from "../engine";
import type { PlatformStreamEvent, StreamTarget } from "./types";

const terminalFrameSchema = z
  .object({
    seq: z.number().int().positive(),
    event: z.literal("terminal.frame"),
    run_id: z.string().min(1),
    ts: z.string().datetime({ offset: true }),
    data: z
      .object({
        stream: z.enum(["stdout", "stderr"]),
        data: z.string(),
      })
      .strict(),
  })
  .strict();

export const permissionRevokedEvent = "permission.revoked";

export function platformEvent(
  target: StreamTarget,
  message: EngineSseMessage,
): PlatformStreamEvent {
  if (target.kind === "terminal") {
    const envelope = terminalFrameSchema.parse(message.data);
    if (envelope.run_id !== target.runId) {
      throw new Error("Engine terminal stream run mismatch");
    }
    return {
      id: `${target.runId}:${envelope.seq}`,
      type: "terminal.frame",
      data: {
        runId: envelope.run_id,
        timestamp: envelope.ts,
        stream: envelope.data.stream,
        data: envelope.data.data,
      },
      key: `terminal:${envelope.seq}`,
      coalescible: false,
    };
  }

  const envelope = SseEnvelopeSchema.parse(message.data);
  if (envelope.run_id !== target.runId) {
    throw new Error("Engine run stream run mismatch");
  }
  const payload = envelope.data as Record<string, unknown>;
  return {
    id: `${target.runId}:${envelope.seq}`,
    type: envelope.event,
    data: {
      runId: envelope.run_id,
      timestamp: envelope.ts,
      payload,
    },
    key: eventKey(envelope.event, envelope.run_id, payload),
    coalescible: coalescibleEvents.has(envelope.event),
  };
}

function eventKey(
  type: string,
  runId: string,
  payload: Record<string, unknown>,
): string {
  const resource =
    payload.node_execution_id ??
    payload.deployment_id ??
    payload.verification_result_id ??
    runId;
  return `${type}:${String(resource)}`;
}

const coalescibleEvents = new Set([
  "run.status",
  "deployment.status",
  "verification.result",
]);
