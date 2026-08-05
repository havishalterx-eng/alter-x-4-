import { proxyActivities } from "@temporalio/workflow";

import type { PlatformJobActivities } from "../activities/platform-job-activities";

export interface PlatformJobWorkflowInput {
  readonly jobType: string;
  readonly payloadJson: string;
}

export interface PlatformJobWorkflowResult {
  readonly resultJson: string;
}

const { executePlatformJob } = proxyActivities<PlatformJobActivities>({
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

/**
 * Real, generic durable job executor for the `platform` Temporal namespace
 * -- one workflow definition for every real Platform Job type, dispatched
 * by `jobType` inside the activity (same shape as Engine's real
 * NodeexecService dispatch-by-node-type pattern). New job types register a
 * new handler, not a new workflow.
 */
export async function platformJobWorkflow(
  input: PlatformJobWorkflowInput,
): Promise<PlatformJobWorkflowResult> {
  return executePlatformJob({
    jobType: input.jobType,
    payloadJson: input.payloadJson,
  });
}
