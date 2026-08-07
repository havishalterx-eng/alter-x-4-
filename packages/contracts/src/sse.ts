import { z } from "./zod";
import {
  ApprovalIdSchema,
  ArtifactIdSchema,
  ClarificationIdSchema,
  DeploymentIdSchema,
  EnvironmentIdSchema,
  IsoTimestampSchema,
  NodeExecutionIdSchema,
  NonEmptyStringSchema,
  ProjectIdSchema,
  RecoveryActionIdSchema,
  RunIdSchema,
  VerificationResultIdSchema,
} from "./ids";
import { NodeTypeSchema } from "./workflow-dag";

const RunStatusSchema = z.enum([
  "running",
  "paused",
  "waiting_approval",
  "completed",
  "failed",
  "escalated",
  "abandoned",
  "degraded",
]);

export const RunStatusDataSchema = z
  .object({
    status: RunStatusSchema,
    previous_status: RunStatusSchema.optional(),
    reason: NonEmptyStringSchema.optional(),
  })
  .strict();

const NodeExecutionBaseSchema = z
  .object({
    node_execution_id: NodeExecutionIdSchema,
    dag_node_key: NonEmptyStringSchema,
    node_type: NodeTypeSchema,
    attempt: z.number().int().positive(),
  })
  .strict();

export const NodeStartedDataSchema = NodeExecutionBaseSchema.extend({
  started_at: IsoTimestampSchema,
}).strict();

export const NodeCompletedDataSchema = NodeExecutionBaseSchema.extend({
  status: z.enum(["succeeded", "recovered"]),
  output_ref: ArtifactIdSchema.optional(),
  ended_at: IsoTimestampSchema,
}).strict();

export const NodeFailedDataSchema = NodeExecutionBaseSchema.extend({
  status: z.literal("failed"),
  error: z
    .object({
      error_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      message: NonEmptyStringSchema,
      retryable: z.boolean(),
    })
    .strict(),
  ended_at: IsoTimestampSchema,
}).strict();

export const ModelDeltaDataSchema = z
  .object({
    node_execution_id: NodeExecutionIdSchema,
    delta: z.string(),
    index: z.number().int().nonnegative(),
    final: z.boolean(),
  })
  .strict();

/** Output returned by a real SandboxExec invocation, ready for xterm relay. */
export const TerminalFrameDataSchema = z
  .object({
    stream: z.enum(["stdout", "stderr"]),
    data: z.string(),
  })
  .strict();

export const VerificationResultDataSchema = z
  .object({
    verification_result_id: VerificationResultIdSchema,
    node_execution_id: NodeExecutionIdSchema.optional(),
    gate_type: z.enum([
      "quality",
      "hallucination",
      "safety",
      "build",
      "render",
      "placeholder",
      "security",
      "acceptance",
    ]),
    verdict: z.enum(["pass", "fail", "warn"]),
    score: z.number().optional(),
    threshold: z.number().optional(),
    details: z.record(z.string(), z.unknown()),
    created_at: IsoTimestampSchema,
  })
  .strict();

export const RecoveryActionDataSchema = z
  .object({
    recovery_action_id: RecoveryActionIdSchema,
    node_execution_id: NodeExecutionIdSchema.optional(),
    failure_class: NonEmptyStringSchema,
    strategy: z.enum([
      "repair",
      "retry",
      "backoff",
      "swap_agent",
      "escalate_model",
      "recompile",
      "replan",
      "degrade",
      "ask_user",
      "terminate",
    ]),
    outcome: z.enum(["resolved", "failed", "escalated"]).optional(),
    policy_version: NonEmptyStringSchema,
    occurred_at: IsoTimestampSchema,
  })
  .strict();

export const ClarificationRequestedDataSchema = z
  .object({
    clarification_id: ClarificationIdSchema,
    question: NonEmptyStringSchema,
    options: z.array(NonEmptyStringSchema),
    required: z.boolean(),
  })
  .strict();

export const ApprovalRequestedDataSchema = z
  .object({
    approval_id: ApprovalIdSchema,
    node_execution_id: NodeExecutionIdSchema.optional(),
    requested_action: z.record(z.string(), z.unknown()),
    requested_at: IsoTimestampSchema,
    expiry_at: IsoTimestampSchema,
  })
  .strict();

export const DeploymentStatusDataSchema = z
  .object({
    deployment_id: DeploymentIdSchema,
    project_id: ProjectIdSchema,
    environment_id: EnvironmentIdSchema,
    status: z.enum(["deploying", "live", "failed", "rolled_back"]),
    updated_at: IsoTimestampSchema,
  })
  .strict();

export const RunDegradedDataSchema = z
  .object({
    reason: NonEmptyStringSchema,
    safe_completed_node_keys: z.array(NonEmptyStringSchema),
    failed_node_keys: z.array(NonEmptyStringSchema),
    action_required: z.boolean(),
  })
  .strict();

export const RunCompletedDataSchema = z
  .object({
    verdict: z.enum([
      "completed_verified",
      "rescued",
      "escalated",
      "failed",
      "abandoned",
      "degraded",
    ]),
    completed_at: IsoTimestampSchema,
    summary: NonEmptyStringSchema.optional(),
  })
  .strict();

const SseSequenceSchema = z.number().int().positive();

function envelope<Event extends string, Data extends z.ZodType>(
  event: Event,
  data: Data,
) {
  return z
    .object({
      seq: SseSequenceSchema.describe(
        "Strictly increasing sequence number within a run_id stream; also used as the SSE event ID for Last-Event-ID resume.",
      ),
      event: z.literal(event),
      run_id: RunIdSchema,
      ts: IsoTimestampSchema,
      data,
    })
    .strict();
}

export const RunStatusSseSchema = envelope(
  "run.status",
  RunStatusDataSchema,
);
export const NodeStartedSseSchema = envelope(
  "node.started",
  NodeStartedDataSchema,
);
export const NodeCompletedSseSchema = envelope(
  "node.completed",
  NodeCompletedDataSchema,
);
export const NodeFailedSseSchema = envelope(
  "node.failed",
  NodeFailedDataSchema,
);
export const ModelDeltaSseSchema = envelope(
  "model.delta",
  ModelDeltaDataSchema,
);
export const TerminalFrameSseSchema = envelope(
  "terminal.frame",
  TerminalFrameDataSchema,
);
export const VerificationResultSseSchema = envelope(
  "verification.result",
  VerificationResultDataSchema,
);
export const RecoveryActionSseSchema = envelope(
  "recovery.action",
  RecoveryActionDataSchema,
);
export const ClarificationRequestedSseSchema = envelope(
  "clarification.requested",
  ClarificationRequestedDataSchema,
);
export const ApprovalRequestedSseSchema = envelope(
  "approval.requested",
  ApprovalRequestedDataSchema,
);
export const DeploymentStatusSseSchema = envelope(
  "deployment.status",
  DeploymentStatusDataSchema,
);
export const RunDegradedSseSchema = envelope(
  "run.degraded",
  RunDegradedDataSchema,
);
export const RunCompletedSseSchema = envelope(
  "run.completed",
  RunCompletedDataSchema,
);

export const SseEnvelopeSchema = z.discriminatedUnion("event", [
  RunStatusSseSchema,
  NodeStartedSseSchema,
  NodeCompletedSseSchema,
  NodeFailedSseSchema,
  ModelDeltaSseSchema,
  TerminalFrameSseSchema,
  VerificationResultSseSchema,
  RecoveryActionSseSchema,
  ClarificationRequestedSseSchema,
  ApprovalRequestedSseSchema,
  DeploymentStatusSseSchema,
  RunDegradedSseSchema,
  RunCompletedSseSchema,
]);

export const SseEventStreamSchema = z
  .array(SseEnvelopeSchema)
  .superRefine((events, context) => {
    const lastSequenceByRun = new Map<string, number>();

    for (const [index, event] of events.entries()) {
      const previous = lastSequenceByRun.get(event.run_id);
      if (previous !== undefined && event.seq <= previous) {
        context.addIssue({
          code: "custom",
          message: "SSE seq must be strictly increasing per run_id",
          path: [index, "seq"],
        });
      }
      lastSequenceByRun.set(event.run_id, event.seq);
    }
  });

export type SseEnvelope = z.infer<typeof SseEnvelopeSchema>;
