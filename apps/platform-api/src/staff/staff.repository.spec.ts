import { describe, expect, it, vi } from "vitest";
import { StaffRepository } from "./staff.repository";

function transactionPool(rows: unknown[]) {
  const client = {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client), client };
}

describe("StaffRepository", () => {
  it("records a use event when an unrevoked grant is active", async () => {
    const grant = {
      id: "jit_active",
      staff_user_id: "stf_staff",
      tenant_id: "00000000-0000-7000-8000-000000000001",
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    };
    const { client, ...pool } = transactionPool([grant]);
    client.query.mockResolvedValueOnce({ rows: [] });
    client.query.mockResolvedValueOnce({ rows: [grant] });
    client.query.mockResolvedValueOnce({ rows: [] });
    client.query.mockResolvedValueOnce({ rows: [] });

    const result = await new StaffRepository(pool as never).active(
      grant.staff_user_id,
      grant.tenant_id,
    );

    expect(result).toEqual(grant);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO jit_grant_audit"),
      expect.arrayContaining([grant.id, "used", grant.staff_user_id]),
    );
  });

  it("records expiry once and denies an expired grant", async () => {
    const grant = {
      id: "jit_expired",
      staff_user_id: "stf_staff",
      tenant_id: "00000000-0000-7000-8000-000000000001",
      expires_at: new Date(Date.now() - 60_000),
      revoked_at: null,
    };
    const { client, ...pool } = transactionPool([grant]);
    client.query.mockResolvedValueOnce({ rows: [] });
    client.query.mockResolvedValueOnce({ rows: [grant] });
    client.query.mockResolvedValueOnce({ rows: [] });
    client.query.mockResolvedValueOnce({ rows: [] });

    const result = await new StaffRepository(pool as never).active(
      grant.staff_user_id,
      grant.tenant_id,
    );

    expect(result).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'expired'"),
      expect.arrayContaining([grant.id, grant.staff_user_id]),
    );
  });
});
