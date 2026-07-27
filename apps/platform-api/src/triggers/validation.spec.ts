import { describe, expect, it } from "vitest";
import {
  parseCreateTrigger,
  parseCreateTriggerVersion,
  parseSetTriggerStatus,
  parseTraceparent,
  parseTriggerId,
  parseWorkflowIdQuery,
} from "./validation";

const instance = "/api/v1/triggers";
const triggerId = "trg_018f47a5-7b2c-7d10-8f11-123456789abc";
const workflowId = "wf_018f47a5-7b2c-7d10-8f11-123456789abc";
const workflowVersionId = "wfv_018f47a5-7b2c-7d10-8f11-123456789abc";
const workspaceId = "ws_018f47a5-7b2c-7d10-8f11-123456789abc";

describe("trigger validation", () => {
  it("preserves camelCase inputs with and without optional fields", () => {
    expect(
      parseCreateTrigger(
        {
          workspaceId,
          workflowId,
          name: " Cron ",
          type: "cron",
          provider: "scheduler",
          workflowVersionId,
          config: { cronExpression: "0 * * * *" },
        },
        instance,
      ),
    ).toEqual({
      workspaceId,
      workflowId,
      name: "Cron",
      type: "cron",
      provider: "scheduler",
      workflowVersionId,
      config: { cronExpression: "0 * * * *" },
    });
    expect(
      parseCreateTrigger(
        { workspaceId, workflowId, name: "Manual", type: "manual" },
        instance,
      ),
    ).toEqual({ workspaceId, workflowId, name: "Manual", type: "manual" });
    expect(
      parseCreateTriggerVersion(
        { workflowVersionId, config: { enabled: true } },
        instance,
      ),
    ).toEqual({ workflowVersionId, config: { enabled: true } });
    expect(parseCreateTriggerVersion({}, instance)).toEqual({});
    expect(parseSetTriggerStatus({ status: "disabled" }, instance)).toEqual({
      status: "disabled",
    });
  });

  it("validates ids, query, trace context, and bodies", () => {
    expect(parseTriggerId(triggerId, instance)).toBe(triggerId);
    expect(parseWorkflowIdQuery(workflowId, instance)).toBe(workflowId);
    expect(parseWorkflowIdQuery(undefined, instance)).toBeUndefined();
    expect(parseTraceparent(undefined, instance)).toBeUndefined();
    expect(
      parseTraceparent(
        "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        instance,
      ),
    ).toContain("00-");

    for (const parse of [
      () => parseTriggerId("bad", instance),
      () => parseWorkflowIdQuery("bad", instance),
      () => parseTraceparent("bad", instance),
      () => parseSetTriggerStatus({ status: "paused" }, instance),
    ]) {
      expect(parse).toThrow(
        expect.objectContaining({
          status: 400,
          response: expect.objectContaining({
            error_code: "INVALID_TRIGGER_REQUEST",
          }),
        }),
      );
    }
  });
});
