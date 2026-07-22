import {
  condition,
  defineQuery,
  defineSignal,
  setHandler,
} from "@temporalio/workflow";

import type { JsonValue } from "@alterx/shared-clients";

export type FoundationWorkflowStatus = "waiting" | "advanced" | "done";

const inputQuery = defineQuery<JsonValue>("input");
const signalsQuery = defineQuery<readonly JsonValue[]>("signals");
const statusQuery = defineQuery<FoundationWorkflowStatus>("status");
const advanceSignal = defineSignal<[JsonValue]>("advance");

export async function foundationNoopWorkflow(
  input: JsonValue,
): Promise<void> {
  const signals: JsonValue[] = [];
  let status: FoundationWorkflowStatus = "waiting";

  setHandler(inputQuery, () => input);
  setHandler(signalsQuery, () => signals);
  setHandler(statusQuery, () => status);
  setHandler(advanceSignal, (payload) => {
    signals.push(payload);
    status = signals.length >= 2 ? "done" : "advanced";
  });

  await condition(() => status === "done");
}
