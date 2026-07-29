import { describe, expect, it, vi } from "vitest";

import type { ModelGatewayHandler } from "@alterx/adapters";
import type {
  ModelgwInvokeRequest,
  RecoveryClassifyFailureRequest,
} from "@alterx/contracts";
import {
  RecoveryPolicyService,
  RecoveryRootCauseUnavailableError,
  RecoveryValidationError,
  type RecoveryTenantStore,
} from "./recovery-policy.service";

const TENANT_ID = "ten_018f47a5-7b2c-7d10-8f11-123456789abc";
const BARE_TENANT_ID = TENANT_ID.slice("ten_".length);
const RUN_ID = "run_018f47a5-7b2c-7d10-8f11-123456789abc";
const NODE_ID = "node_018f47a5-7b2c-7d10-8f11-123456789abc";
const RECOVERY_ID = "rec_018f47a5-7b2c-7d10-8f11-123456789abc";

function request(
  observation: Record<string, unknown> = {},
): RecoveryClassifyFailureRequest {
  return {
    tenant_id: TENANT_ID,
    run_id: RUN_ID,
    node_execution_id: NODE_ID,
    error_json: JSON.stringify({
      trace_id: "trc_018f47a5-7b2c-7d10-8f11-123456789abc",
      request_id: "req_018f47a5-7b2c-7d10-8f11-123456789abc",
      ...observation,
    }),
  };
}

function harness(options: {
  readonly durableError?: Record<string, unknown>;
  readonly modelFailure?: Error;
  readonly modelOutput?: unknown;
} = {}) {
  let pending: unknown;
  const query = vi.fn(
    async (statement: string, values: readonly unknown[] = []) => {
      if (statement.includes("FROM node_executions")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: NODE_ID,
              node_type: "SandboxExec",
              attempt: 2,
              status: "failed",
              error: options.durableError ?? {
                code: "SANDBOX_BUILD_INFRA_FAILURE",
                retryable: true,
              },
            },
          ],
        };
      }
      if (statement.includes("FROM recovery_actions")) {
        return pending === undefined
          ? { rowCount: 0, rows: [] }
          : {
              rowCount: 1,
              rows: [
                {
                  failure_class: (pending as { failure_class: string })
                    .failure_class,
                  root_cause_estimate: pending,
                },
              ],
            };
      }
      if (statement.includes("INSERT INTO recovery_actions")) {
        pending = JSON.parse(String(values[5]));
        return { rowCount: 1, rows: [{ id: values[0] }] };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    },
  );
  const store = {
    async withTenant<T>(
      tenantId: string,
      operation: (transaction: { query: typeof query }) => Promise<T>,
    ): Promise<T> {
      expect(tenantId).toBe(BARE_TENANT_ID);
      return operation({ query });
    },
  } as unknown as RecoveryTenantStore;
  const invoke = vi.fn(async (modelRequest: ModelgwInvokeRequest) => {
    if (modelRequest.model_alias !== "ADVANCED") {
      throw new Error("test harness accepts only ADVANCED root-cause calls");
    }
    if (options.modelFailure !== undefined) throw options.modelFailure;
    return {
      output_json: JSON.stringify(
        options.modelOutput ?? {
          explanation: "The isolated sandbox runtime became unavailable.",
          confidence: 0.96,
          evidence: ["SANDBOX_BUILD_INFRA_FAILURE", "retryable=true"],
        },
      ),
      usage_json: "{}",
      resolved_capability: "ADVANCED:anthropic.claude-sonnet",
    };
  });
  const model = { invoke } as unknown as ModelGatewayHandler;
  return {
    service: new RecoveryPolicyService(store, model, () => RECOVERY_ID),
    invoke,
    query,
  };
}

describe("RecoveryPolicyService", () => {
  it("classifies durable execution evidence, calls ADVANCED, and persists a HEAL-6-ready row", async () => {
    const { service, invoke, query } = harness();
    const response = await service.classifyFailure(
      request({
        verification: {
          kind: "build",
          status: "infra_failure",
          error_code: "SANDBOX_BUILD_INFRA_FAILURE",
        },
      }),
    );

    expect(response.failure_class).toBe("infrastructure_failure");
    expect(response.confidence).toBe(0.96);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ model_alias: "ADVANCED" }),
    );
    const modelInput = JSON.parse(invoke.mock.calls[0]![0].input_json);
    expect(modelInput.task).toContain("Do not select or recommend");
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO recovery_actions"),
    );
    expect(insert?.[0]).toContain("NULL, NULL");
    expect(insert?.[1]).toHaveLength(6);
    expect(insert?.[1]?.slice(0, 5)).toEqual([
      RECOVERY_ID,
      BARE_TENANT_ID,
      RUN_ID,
      NODE_ID,
      "infrastructure_failure",
    ]);
  });

  it("caps ambiguous classification confidence instead of silently defaulting", async () => {
    const { service } = harness({
      durableError: { code: "TOOL_GATEWAY_PERMISSION_DENIED" },
    });
    const response = await service.classifyFailure(
      request({ error_code: "DEADLINE_EXCEEDED" }),
    );
    expect(response).toMatchObject({ failure_class: "unknown", confidence: 0.25 });
  });

  it("fails closed and writes nothing when Model Gateway is unreachable", async () => {
    const { service, query } = harness({
      modelFailure: new Error("connection refused"),
    });
    await expect(service.classifyFailure(request())).rejects.toBeInstanceOf(
      RecoveryRootCauseUnavailableError,
    );
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO recovery_actions"),
      ),
    ).toBe(false);
  });

  it("rejects a bare UUID tenant before database or model access", async () => {
    const { service, invoke, query } = harness();
    await expect(
      service.classifyFailure({
        ...request(),
        tenant_id: BARE_TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(RecoveryValidationError);
    expect(query).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects malformed model output as unavailable and never persists it", async () => {
    const { service, query } = harness({
      modelOutput: {
        explanation: "plausible",
        confidence: 0.8,
        evidence: ["one"],
        strategy: "retry",
      },
    });
    await expect(service.classifyFailure(request())).rejects.toBeInstanceOf(
      RecoveryRootCauseUnavailableError,
    );
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO recovery_actions"),
      ),
    ).toBe(false);
  });
});
