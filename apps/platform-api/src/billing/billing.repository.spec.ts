import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingRepository } from "./billing.repository";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const now = new Date("2026-07-28T10:00:00.000Z");
const profileRow = {
  tenant_id: tenantId,
  id: "018f47a5-7b2c-7d10-8f11-123456789abd",
  provider_id: "razorpay",
  provider_customer_ref: "customer_123",
  subscription_ref: "subscription_123",
  status: "active",
  current_plan: "plan_basic",
  created_at: now,
  updated_at: now,
};

describe("BillingRepository", () => {
  let query: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;
  let end: ReturnType<typeof vi.fn>;
  let repository: BillingRepository;

  beforeEach(() => {
    query = vi.fn(async (sql: string) => {
      if (sql.includes("RETURNING id")) return result([{ id: profileRow.id }]);
      if (sql.includes("RETURNING *") || sql.includes("billing_profiles WHERE")) {
        return result([profileRow]);
      }
      if (sql.includes("SELECT ref")) {
        return result([
          { ref: "token_123", type: "card", brand: "Visa", last4: "4242" },
        ]);
      }
      return result([]);
    });
    release = vi.fn();
    end = vi.fn(async () => undefined);
    const client = { query, release } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      end,
    } as unknown as Pool;
    repository = new BillingRepository(pool, true);
  });

  it("uses tenant transactions for profile and subscription references", async () => {
    await expect(repository.getProfile(tenantId)).resolves.toMatchObject({
      tenantId,
      subscriptionRef: "subscription_123",
    });
    await expect(repository.getTenantReferences(tenantId)).resolves.toEqual({
      providerCustomerRef: "customer_123",
      subscriptionRef: "subscription_123",
    });
    await repository.setSubscriptionReferences(tenantId, {
      providerCustomerRef: "customer_123",
      subscriptionRef: "subscription_123",
    });
    await expect(
      repository.syncSubscription(tenantId, {
        id: "subscription_123",
        tenantId,
        planId: "plan_pro",
        status: "active",
        providerCustomerRef: "customer_123",
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: now.toISOString(),
      }),
    ).resolves.toMatchObject({ currentPlan: "plan_basic" });

    expect(query).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE tenants SET billing_profile_id"),
      [tenantId, profileRow.id],
    );
    expect(release).toHaveBeenCalledTimes(4);
  });

  it("stores and returns provider references without payment credentials", async () => {
    await repository.savePaymentMethod(tenantId, {
      ref: "token_123",
      type: "card",
      brand: "Visa",
      last4: "4242",
    });
    await expect(repository.listPaymentMethods(tenantId)).resolves.toEqual([
      { ref: "token_123", type: "card", brand: "Visa", last4: "4242" },
    ]);
    await repository.deletePaymentMethod(tenantId, "token_123");

    const transcript = JSON.stringify(query.mock.calls);
    expect(transcript).not.toContain("4111111111111111");
    expect(transcript).not.toContain("987");
    expect(transcript).not.toContain("card_number");
    expect(transcript).not.toContain("cvv");
  });

  it("handles missing profiles, rollback, and owned-pool shutdown", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("billing_profiles WHERE")) return result([]);
      return result([]);
    });
    await expect(repository.getProfile(tenantId)).resolves.toBeNull();
    await expect(repository.getTenantReferences(tenantId)).resolves.toBeNull();

    query.mockImplementation(async (sql: string) => {
      if (sql.includes("billing_profiles WHERE")) throw new Error("db down");
      return result([]);
    });
    await expect(repository.getProfile(tenantId)).rejects.toThrow("db down");
    expect(query).toHaveBeenCalledWith("ROLLBACK");
    await repository.onModuleDestroy();
    expect(end).toHaveBeenCalledOnce();
  });

  it("does not close an injected pool it does not own", async () => {
    const client = { query, release } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      end,
    } as unknown as Pool;
    await new BillingRepository(pool).onModuleDestroy();
    expect(end).not.toHaveBeenCalled();
  });

});

function result<T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length,
): QueryResult<T> {
  return {
    rows,
    rowCount,
    command: "",
    oid: 0,
    fields: [],
  };
}
