import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PlatformDb } from "./platform-db";

function poolWith(query: ReturnType<typeof vi.fn>) {
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  return {
    pool: {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn(),
    } as unknown as Pool,
    release,
  };
}

const input = {
  userId: "00000000-0000-7000-8000-000000000101",
  tenantId: "00000000-0000-7000-8000-000000000001",
  workspaceId: "00000000-0000-7000-8000-000000000201",
  identityRef: "auth0|user",
  email: "user@example.com",
  tenantName: "User's Workspace",
  identityOrgRef: "org_1",
};

describe("PlatformDb signup transaction", () => {
  it("commits all inserts and entitlement callback together", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { pool, release } = poolWith(query);
    const beforeCommit = vi.fn().mockResolvedValue("entitlement");
    await expect(new PlatformDb(pool).createSignup(input, beforeCommit)).resolves.toBe(
      "entitlement",
    );
    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [input.tenantId],
    );
    expect(beforeCommit).toHaveBeenCalledWith(expect.anything());
    expect(query).toHaveBeenLastCalledWith("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back transaction when entitlement callback fails", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { pool, release } = poolWith(query);
    await expect(
      new PlatformDb(pool).createSignup(input, async () => {
        throw new Error("entitlement failed");
      }),
    ).rejects.toThrow("entitlement failed");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });

  it("finds returning user and prefers the hinted tenant", async () => {
    const { pool } = poolWith(vi.fn());
    vi.mocked(pool.query).mockResolvedValue({
      rows: [
        {
          userId: input.userId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          tenantRole: "owner",
          workspaceRole: "admin",
        },
      ],
    } as never);
    await expect(
      new PlatformDb(pool).findExisting(input.identityRef, input.tenantId),
    ).resolves.toMatchObject({ userId: input.userId, tenantId: input.tenantId });
    expect(pool.query).toHaveBeenLastCalledWith(
      "SELECT * FROM resolve_existing_signup($1, $2::uuid)",
      [input.identityRef, input.tenantId],
    );
  });

  it("returns no existing signup for a missing user", async () => {
    const { pool } = poolWith(vi.fn());
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    await expect(
      new PlatformDb(pool).findExisting("missing", input.tenantId),
    ).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it.each(["", "not-a-uuid"])(
    "finds returning user without a valid tenant hint (%j)",
    async (tenantHint) => {
      const existing = {
        userId: input.userId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        tenantRole: "owner",
        workspaceRole: "admin",
      };
      const { pool } = poolWith(vi.fn());
      vi.mocked(pool.query).mockResolvedValue({ rows: [existing] } as never);

      await expect(
        new PlatformDb(pool).findExisting(input.identityRef, tenantHint),
      ).resolves.toEqual(existing);
      expect(pool.query).toHaveBeenLastCalledWith(expect.any(String), [
        input.identityRef,
        null,
      ]);
    },
  );

  it("uses the newest membership when the tenant hint does not match", async () => {
    const existing = {
      userId: input.userId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      tenantRole: "owner",
      workspaceRole: "admin",
    };
    const { pool } = poolWith(vi.fn());
    vi.mocked(pool.query).mockResolvedValue({ rows: [existing] } as never);

    await expect(
      new PlatformDb(pool).findExisting(
        input.identityRef,
        "00000000-0000-7000-8000-000000000999",
      ),
    ).resolves.toEqual(existing);
    expect(pool.query).toHaveBeenLastCalledWith(
      "SELECT * FROM resolve_existing_signup($1, $2::uuid)",
      [input.identityRef, "00000000-0000-7000-8000-000000000999"],
    );
  });

  it("returns no existing signup when membership lookup is empty", async () => {
    const { pool } = poolWith(vi.fn().mockResolvedValue({ rows: [] }));
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never);
    await expect(
      new PlatformDb(pool).findExisting(input.identityRef, input.tenantId),
    ).resolves.toBeNull();
  });

  it("runs tenant query and returns rows", async () => {
    const query = vi.fn().mockImplementation(async (sql: string) =>
      sql === "SELECT value" ? { rows: [{ value: 1 }] } : { rows: [] },
    );
    const { pool } = poolWith(query);
    await expect(
      new PlatformDb(pool).queryTenant<{ value: number }>(
        input.tenantId,
        "SELECT value",
      ),
    ).resolves.toEqual([{ value: 1 }]);
  });
});
