import {
  ParentClosePolicy,
  allHandlersFinished,
  condition,
  defineQuery,
  defineSignal,
  log,
  setHandler,
  startChild,
} from "@temporalio/workflow";

import type { JsonValue } from "@alterx/shared-clients";

export type ConversationLifecycleStatus = "active" | "idle" | "closed";

export interface IncomingConversationMessage {
  readonly messageId: string;
  readonly channel: "web" | "whatsapp" | "voice" | "api";
  readonly payload: JsonValue;
  readonly receivedAt: string;
}

export interface ConversationLifecycleInput {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly idleTimeoutSeconds: number;
}

export interface SpawnChildRunSignalPayload {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly taskQueue: string;
  readonly input: JsonValue;
}

export const messageSignal =
  defineSignal<[IncomingConversationMessage]>("message");
export const spawnChildRunSignal =
  defineSignal<[SpawnChildRunSignalPayload]>("spawnChildRun");
export const closeSignal = defineSignal<[]>("close");

export const messagesQuery =
  defineQuery<readonly IncomingConversationMessage[]>("messages");
export const statusQuery = defineQuery<ConversationLifecycleStatus>("status");
export const childRunIdsQuery = defineQuery<readonly string[]>("childRunIds");

export async function conversationLifecycleWorkflow(
  input: ConversationLifecycleInput,
): Promise<void> {
  const messages: IncomingConversationMessage[] = [];
  const seenMessageIds = new Set<string>();
  const childRunIds: string[] = [];
  let status: ConversationLifecycleStatus = "active";
  let closeRequested = false;
  // Deterministic activity counter instead of Date.now()-based idle math --
  // any signal that represents "the conversation is alive" bumps this, and
  // the wait loop below resets its idle clock whenever it moves.
  let activityCounter = 0;

  setHandler(messageSignal, (message) => {
    if (seenMessageIds.has(message.messageId)) {
      return;
    }
    seenMessageIds.add(message.messageId);
    messages.push(message);
    activityCounter += 1;
  });

  setHandler(spawnChildRunSignal, async (payload) => {
    activityCounter += 1;
    try {
      // ABANDON: a spawned run (e.g. a workflow execution triggered mid
      // conversation) must keep going even if this conversation closes or
      // idles out afterward -- the two lifecycles are intentionally decoupled.
      const handle = await startChild(payload.workflowType, {
        workflowId: payload.workflowId,
        taskQueue: payload.taskQueue,
        args: [payload.input],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      });
      childRunIds.push(handle.workflowId);
    } catch (error) {
      // A bad payload (e.g. a reused child workflowId) must not crash this
      // conversation's own workflow task -- log and keep the conversation alive.
      log.warn("conversationLifecycleWorkflow: failed to spawn child run", {
        workflowId: payload.workflowId,
        workflowType: payload.workflowType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  setHandler(closeSignal, () => {
    closeRequested = true;
  });

  setHandler(messagesQuery, () => messages);
  setHandler(statusQuery, () => status);
  setHandler(childRunIdsQuery, () => childRunIds);

  const idleTimeoutMs = input.idleTimeoutSeconds * 1000;
  while (!closeRequested) {
    const counterAtWaitStart = activityCounter;
    const activityHappened = await condition(
      () => closeRequested || activityCounter > counterAtWaitStart,
      idleTimeoutMs,
    );
    if (!activityHappened) {
      status = "idle";
      break;
    }
    if (!closeRequested) {
      status = "active";
    }
  }

  status = "closed";
  await condition(allHandlersFinished);
}
