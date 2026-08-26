import { describe, expect, it, vi } from "vitest";
import { InvalidSupportAccessCursorError, StaffRepository } from "./staff.repository";

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

  // ENGINE-FIX-B8-2: list()'s includeAll branch used to run with no LIMIT
  // at all -- these prove it's now cursor-paginated like listForTenant.
  describe("list() pagination", () => {
    function grantRow(id: string, grantedAt: string) {
      return {
        id,
        staff_user_id: "stf_someone",
        tenant_id: "00000000-0000-7000-8000-000000000001",
        granted_at: new Date(grantedAt),
        expires_at: new Date("2026-08-06T12:00:00.000Z"),
        revoked_at: null,
        reason_code: "support_case",
        reason_text: "Investigate",
        scopes: ["tenant:read"],
      };
    }

    it("caps the includeAll (staff_admin) branch with a real LIMIT and paginates", async () => {
      const rows = [grantRow("jit_1", "2026-08-06T10:02:00Z"), grantRow("jit_2", "2026-08-06T10:01:00Z")];
      const pool = { query: vi.fn().mockResolvedValue({ rows }) };
      const repository = new StaffRepository(pool as never);

      const page = await repository.list("stf_admin", true, { limit: 1 });

      expect(page.data).toEqual([rows[0]]);
      expect(page.page).toMatchObject({ has_more: true, limit: 1 });
      expect(page.page.next_cursor).toEqual(expect.any(String));
      const [sql, params] = pool.query.mock.calls[0]!;
      expect(sql).not.toContain("staff_user_id");
      expect(sql).toContain("LIMIT $3");
      expect(params).toEqual([null, null, 2]);
    });

    it("scopes the per-staff-user branch by staff_user_id and still applies a LIMIT", async () => {
      const rows = [grantRow("jit_1", "2026-08-06T10:00:00Z")];
      const pool = { query: vi.fn().mockResolvedValue({ rows }) };
      const repository = new StaffRepository(pool as never);

      const page = await repository.list("stf_someone", false, { limit: 50 });

      expect(page.data).toEqual(rows);
      expect(page.page).toMatchObject({ has_more: false, next_cursor: null, limit: 50 });
      const [sql, params] = pool.query.mock.calls[0]!;
      expect(sql).toContain("staff_user_id = $1");
      expect(params).toEqual(["stf_someone", null, null, 51]);
    });

    it("threads a decoded cursor's tiebreak into the query and rejects a malformed one", async () => {
      const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      const repository = new StaffRepository(pool as never);
      const cursor = Buffer.from(
        JSON.stringify({ grantedAt: "2026-08-06T10:00:00.000Z", id: "jit_prev" }),
        "utf8",
      ).toString("base64url");

      await repository.list("stf_admin", true, { cursor, limit: 25 });
      const [, params] = pool.query.mock.calls[0]!;
      expect(params).toEqual(["2026-08-06T10:00:00.000Z", "jit_prev", 26]);

      await expect(repository.list("stf_admin", true, { cursor: "not-a-cursor", limit: 25 })).rejects.toBeInstanceOf(
        InvalidSupportAccessCursorError,
      );
    });
  });
});
