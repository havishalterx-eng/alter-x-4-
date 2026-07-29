import { describe, expect, it, vi } from "vitest";

import { RecoveryTriggerService } from "./recovery-trigger.service";

const TENANT_ID = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const RUN_ID = "run_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const NODE_EXECUTION_ID = "node_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";

function service() {
  const classifyFailure = vi.fn().mockResolvedValue({
    failure_class: "timeout",
    confidence: 0.9,
    root_cause_estimate_json: "{}",
  });
  const selectStrategy = vi.fn().mockResolvedValue({
    recovery_action_id: "rec_test",
    strategy: "retry",
    policy_id: "pol_test",
    policy_version: "v1",
  });
  const trigger = new RecoveryTriggerService({ classifyFailure }, { selectStrategy });
  return { trigger, classifyFailure, selectStrategy };
}

describe("RecoveryTriggerService", () => {
  it("triggerForBlockedNode classifies with the synthetic Gate error_code and the caller's reason", async () => {
    const { trigger, classifyFailure, selectStrategy } = service();

    await trigger.triggerForBlockedNode({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      nodeExecutionId: NODE_EXECUTION_ID,
      reason: "verification blocked external action",
    });

    const [classifyRequest] = classifyFailure.mock.calls[0] as [{ error_json: string }];
    expect(JSON.parse(classifyRequest.error_json)).toMatchObject({
      error_code: "VERIFICATION_BLOCKED_PENDING_RECOVERY",
      detail: "verification blocked external action",
    });
    expect(selectStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ node_execution_id: NODE_EXECUTION_ID, failure_class: "timeout" }),
    );
  });

  it("triggerForFailedNode classifies with the real error_code/detail, not a fabricated Gate reason", async () => {
    const { trigger, classifyFailure, selectStrategy } = service();

    await trigger.triggerForFailedNode({
      tenantId: TENANT_ID,
      runId: RUN_ID,
      nodeExecutionId: NODE_EXECUTION_ID,
      errorCode: "NODE_EXECUTION_FAILED",
      detail: "Node execution failed",
    });

    const [classifyRequest] = classifyFailure.mock.calls[0] as [{ error_json: string }];
    expect(JSON.parse(classifyRequest.error_json)).toMatchObject({
      error_code: "NODE_EXECUTION_FAILED",
      detail: "Node execution failed",
    });
    expect(selectStrategy).toHaveBeenCalledWith(
      expect.objectContaining({ node_execution_id: NODE_EXECUTION_ID, failure_class: "timeout" }),
    );
  });
});
