import { describe, expect, it } from "vitest";
import {
  ApprovalRequestedDataSchema,
  ClarificationRequestedDataSchema,
  DeploymentStatusDataSchema,
  ModelDeltaDataSchema,
  NodeCompletedDataSchema,
  NodeFailedDataSchema,
  NodeStartedDataSchema,
  RecoveryActionDataSchema,
  RunCompletedDataSchema,
  RunDegradedDataSchema,
  RunStatusDataSchema,
  SseEnvelopeSchema,
  SseEventStreamSchema,
  VerificationResultDataSchema,
} from "./sse";
import { ids, timestamp } from "./test-fixtures";

const variants = [
  {
    event: "run.status",
    schema: RunStatusDataSchema,
    data: { status: "running" },
  },
  {
    event: "node.started",
    schema: NodeStartedDataSchema,
    data: {
      node_execution_id: ids.nodeExecution,
      dag_node_key: "start",
      node_type: "LLMTask",
      attempt: 1,
      started_at: timestamp,
    },
  },
  {
    event: "node.completed",
    schema: NodeCompletedDataSchema,
    data: {
      node_execution_id: ids.nodeExecution,
      dag_node_key: "start",
      node_type: "LLMTask",
      attempt: 1,
      status: "succeeded",
      output_ref: ids.artifact,
      ended_at: timestamp,
    },
  },
  {
    event: "node.failed",
    schema: NodeFailedDataSchema,
    data: {
      node_execution_id: ids.nodeExecution,
      dag_node_key: "start",
      node_type: "LLMTask",
      attempt: 1,
      status: "failed",
      error: {
        error_code: "MODEL_TIMEOUT",
        message: "The model timed out.",
        retryable: true,
      },
      ended_at: timestamp,
    },
  },
  {
    event: "model.delta",
    schema: ModelDeltaDataSchema,
    data: {
      node_execution_id: ids.nodeExecution,
      delta: "hello",
      index: 0,
      final: false,
    },
  },
  {
    event: "verification.result",
    schema: VerificationResultDataSchema,
    data: {
      verification_result_id: ids.verification,
      node_execution_id: ids.nodeExecution,
      gate_type: "quality",
      verdict: "pass",
      score: 0.98,
      threshold: 0.9,
      details: {},
      created_at: timestamp,
    },
  },
  {
    event: "recovery.action",
    schema: RecoveryActionDataSchema,
    data: {
      recovery_action_id: ids.recovery,
      node_execution_id: ids.nodeExecution,
      failure_class: "provider_timeout",
      strategy: "retry",
      outcome: "resolved",
      policy_version: "1.0.0",
      occurred_at: timestamp,
    },
  },
  {
    event: "clarification.requested",
    schema: ClarificationRequestedDataSchema,
    data: {
      clarification_id: ids.clarification,
      question: "Which environment?",
      options: ["staging", "production"],
      required: true,
    },
  },
  {
    event: "approval.requested",
    schema: ApprovalRequestedDataSchema,
    data: {
      approval_id: ids.approval,
      node_execution_id: ids.nodeExecution,
      requested_action: { action: "send_message" },
      requested_at: timestamp,
      expiry_at: "2026-07-22T12:05:00.000Z",
    },
  },
  {
    event: "deployment.status",
    schema: DeploymentStatusDataSchema,
    data: {
      deployment_id: ids.deployment,
      project_id: ids.project,
      environment_id: ids.environment,
      status: "live",
      updated_at: timestamp,
    },
  },
  {
    event: "run.degraded",
    schema: RunDegradedDataSchema,
    data: {
      reason: "Optional report failed",
      safe_completed_node_keys: ["start"],
      failed_node_keys: ["report"],
      action_required: false,
    },
  },
  {
    event: "run.completed",
    schema: RunCompletedDataSchema,
    data: {
      verdict: "completed_verified",
      completed_at: timestamp,
      summary: "All gates passed.",
    },
  },
] as const;

describe("SSE data schemas", () => {
  it("accepts one valid fixture for every event data schema", () => {
    for (const variant of variants) {
      expect(variant.schema.safeParse(variant.data).success).toBe(true);
    }
  });

  it("rejects one invalid fixture for every event data schema", () => {
    for (const variant of variants) {
      expect(variant.schema.safeParse({}).success).toBe(false);
    }
  });
});

describe("SseEnvelopeSchema", () => {
  it("accepts all 12 discriminated event variants", () => {
    variants.forEach((variant, index) => {
      expect(
        SseEnvelopeSchema.safeParse({
          seq: index + 1,
          event: variant.event,
          run_id: ids.run,
          ts: timestamp,
          data: variant.data,
        }).success,
      ).toBe(true);
    });
  });

  it("rejects an invented event type", () => {
    expect(
      SseEnvelopeSchema.safeParse({
        seq: 1,
        event: "run.unknown",
        run_id: ids.run,
        ts: timestamp,
        data: {},
      }).success,
    ).toBe(false);
  });
});

describe("SseEventStreamSchema", () => {
  const statusEnvelope = (seq: number) => ({
    seq,
    event: "run.status" as const,
    run_id: ids.run,
    ts: timestamp,
    data: { status: "running" as const },
  });

  it("accepts strictly increasing sequences per run", () => {
    expect(
      SseEventStreamSchema.safeParse([
        statusEnvelope(1),
        statusEnvelope(2),
      ]).success,
    ).toBe(true);
  });

  it("rejects duplicate or decreasing sequence numbers", () => {
    expect(
      SseEventStreamSchema.safeParse([
        statusEnvelope(2),
        statusEnvelope(2),
      ]).success,
    ).toBe(false);
  });
});
