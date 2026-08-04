import { describe, expect, it, vi } from "vitest";
import { CostLedgerClient } from "../engine";
import type { ActorContext } from "../rbac/types";
import { CostsService } from "./costs.service";

const actor: ActorContext = {
  user_id: "usr_018f47a5-7b2c-7d10-8f11-123456789abc",
  tenant_id: "ten_018f47a5-7b2c-7d10-8f11-123456789abc",
  workspace_id: "ws_018f47a5-7b2c-7d10-8f11-123456789abc",
  session_id: "session-a",
  roles: ["viewer"],
  permissions: ["billing:read"],
};

describe("CostsService", () => {
  it("reshapes all supported rollup dimensions into typed customer response", async () => {
    const client = {
      getSummary: vi.fn().mockResolvedValue(JSON.stringify({
        start_at: "2026-01-01T00:00:00.000Z",
        end_at: "2026-02-01T00:00:00.000Z",
        currency: "INR",
        dimensions: ["mode", "source", "provider", "resource"],
        groups: [{
          dimensions: {
            mode: "workflow",
            source: "model_gateway",
            provider: "bedrock",
            resource: "claude",
          },
          internal_cost_minor: "100",
          retry_cost_minor: "10",
          recovery_cost_minor: "5",
          billable_minor: "143",
          margin_minor: "43",
          event_count: 2,
        }],
        totals: { internal_cost_minor: "100", billable_minor: "143", margin_minor: "43" },
      })),
    } as unknown as CostLedgerClient;
    const service = new CostsService(client);

    await expect(service.summary({
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-02-01T00:00:00.000Z",
      currency: "INR",
      dimensions: ["mode", "source", "provider", "resource"],
    }, actor, undefined)).resolves.toEqual({
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-02-01T00:00:00.000Z",
      currency: "INR",
      dimensions: ["mode", "source", "provider", "resource"],
      groups: [{
        dimensions: { mode: "workflow", source: "model_gateway", provider: "bedrock", resource: "claude" },
        internalCostMinor: "100",
        retryCostMinor: "10",
        recoveryCostMinor: "5",
        billableMinor: "143",
        marginMinor: "43",
        eventCount: 2,
      }],
      totals: { internalCostMinor: "100", billableMinor: "143", marginMinor: "43" },
    });
  });

  it("accepts real empty state and rejects malformed upstream rollups", async () => {
    const client = {
      getSummary: vi.fn()
        .mockResolvedValueOnce(JSON.stringify({
          start_at: "2026-01-01T00:00:00.000Z",
          end_at: "2026-02-01T00:00:00.000Z",
          currency: "INR",
          dimensions: [], groups: [],
          totals: { internal_cost_minor: "0", billable_minor: "0", margin_minor: "0" },
        }))
        .mockResolvedValueOnce("not-json"),
    } as unknown as CostLedgerClient;
    const service = new CostsService(client);
    const query = { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-02-01T00:00:00.000Z" };

    await expect(service.summary(query, actor, undefined)).resolves.toMatchObject({ groups: [] });
    await expect(service.summary(query, actor, undefined)).rejects.toMatchObject({
      response: { status: 502, error_code: "INVALID_COST_ROLLUP_RESPONSE" },
    });
  });
});
