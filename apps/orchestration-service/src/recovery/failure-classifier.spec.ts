import { describe, expect, it } from "vitest";

import type { FailureObservation } from "@alterx/contracts";
import { classifyNodeFailure } from "./failure-classifier";

const BASE_OBSERVATION: FailureObservation = {
  trace_id: "trc_018f47a5-7b2c-7d10-8f11-123456789abc",
  request_id: "req_018f47a5-7b2c-7d10-8f11-123456789abc",
};

describe("classifyNodeFailure", () => {
  it("classifies EXEC-12's seeded sandbox build infrastructure failure", () => {
    expect(
      classifyNodeFailure(
        {
          nodeType: "SandboxExec",
          attempt: 2,
          error: { code: "SANDBOX_BUILD_INFRA_FAILURE", retryable: true },
        },
        {
          ...BASE_OBSERVATION,
          verification: {
            kind: "build",
            status: "infra_failure",
            error_code: "SANDBOX_BUILD_INFRA_FAILURE",
          },
        },
      ),
    ).toMatchObject({ failureClass: "infrastructure_failure" });
  });

  it("classifies a real AgentCreationFailedError code as agent_creation_failure", () => {
    expect(
      classifyNodeFailure(
        {
          nodeType: "LLMTask",
          attempt: 1,
          error: { code: "AGENT_CREATION_FAILED", retryable: false },
        },
        BASE_OBSERVATION,
      ),
    ).toMatchObject({ failureClass: "agent_creation_failure" });
  });

  it("classifies EXEC-12's seeded bad-output failure as logic, not infrastructure", () => {
    expect(
      classifyNodeFailure(
        {
          nodeType: "SandboxExec",
          attempt: 1,
          error: { code: "SANDBOX_RENDER_PLACEHOLDER_DETECTED" },
        },
        {
          ...BASE_OBSERVATION,
          verification: {
            kind: "render",
            status: "logic_failure",
            error_code: "SANDBOX_RENDER_LOGIC_FAILURE",
          },
        },
      ),
    ).toMatchObject({ failureClass: "logic_output_failure" });
  });

  it.each([
    ["TOOL_GATEWAY_PERMISSION_DENIED", "tool_permission_denial"],
    ["DEADLINE_EXCEEDED", "timeout"],
    ["SANDBOX_SESSION_LOST", "sandbox_crash"],
    ["TOOL_GATEWAY_RATE_LIMITED", "rate_limit"],
  ] as const)("maps %s to %s", (code, failureClass) => {
    expect(
      classifyNodeFailure(
        { nodeType: "ToolCall", attempt: 1, error: { code } },
        BASE_OBSERVATION,
      ).failureClass,
    ).toBe(failureClass);
  });

  it("consumes HEAL-3 severity only as an optional additive signal", () => {
    expect(
      classifyNodeFailure(
        { nodeType: "LLMTask", attempt: 1, error: {} },
        { ...BASE_OBSERVATION, safety_severity: "critical" },
      ).failureClass,
    ).toBe("safety_violation");
  });

  it("returns unknown with a low ceiling for conflicting top signals", () => {
    expect(
      classifyNodeFailure(
        {
          nodeType: "ToolCall",
          attempt: 1,
          error: { code: "TOOL_GATEWAY_PERMISSION_DENIED" },
        },
        { ...BASE_OBSERVATION, error_code: "DEADLINE_EXCEEDED" },
      ),
    ).toEqual({
      failureClass: "unknown",
      confidenceCeiling: 0.25,
      evidence: [
        "conflicting top signals: tool_permission_denial, timeout",
      ],
    });
  });
});
