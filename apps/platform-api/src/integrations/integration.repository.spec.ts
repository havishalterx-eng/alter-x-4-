import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import { IntegrationRepository } from "./integration.repository";

const tenantId = "00000000-0000-7000-8000-000000000001";
const workspaceId = "00000000-0000-7000-8000-000000000011";
const now = new Date("2026-08-06T12:00:00.000Z");

describe("IntegrationRepository workspace connector configuration", () => {
  it("upserts and reads configuration inside tenant transactions", async () => {
    const row = {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      connector: "zendesk",
      config_json: { connector: "zendesk", subdomain: "alter-support" },
      created_at: now,
      updated_at: now,
    };
    const client = fakeClient((sql) =>
      sql.includes("workspace_connector_configs") ? [row] : [],
    );
    const repository = new IntegrationRepository(fakePool(client));

    await expect(
      repository.upsertConnectorConfig(tenantId, workspaceId, "zendesk", {
        connector: "zendesk",
        subdomain: "alter-support",
      }),
    ).resolves.toEqual({
      tenantId,
      workspaceId,
      connector: "zendesk",
      config: { connector: "zendesk", subdomain: "alter-support" },
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      repository.findConnectorConfig(tenantId, workspaceId, "zendesk"),
    ).resolves.toMatchObject({ connector: "zendesk" });
    expect(client.query).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(2);
  });

  it("returns undefined when the workspace has no connector configuration", async () => {
    const client = fakeClient(() => []);
    const repository = new IntegrationRepository(fakePool(client));
    await expect(
      repository.findConnectorConfig(tenantId, workspaceId, "zendesk"),
    ).resolves.toBeUndefined();
  });

  it("creates and reads OAuth state records", async () => {
    const row = {
      tenant_id: tenantId,
      id: "state-1",
      workspace_id: workspaceId,
      connector: "zendesk",
      code_verifier: "verifier",
      redirect_uri: "https://app.alter.ai/callback",
      created_by: "00000000-0000-7000-8000-000000000021",
      created_at: now,
      expires_at: new Date("2026-08-06T12:05:00.000Z"),
    };
    const client = fakeClient((sql) =>
      sql.includes("oauth_states") ? [row] : [],
    );
    const repository = new IntegrationRepository(fakePool(client));
    const input = {
      id: row.id,
      workspaceId,
      connector: "zendesk" as const,
      codeVerifier: row.code_verifier,
      redirectUri: row.redirect_uri,
      createdBy: row.created_by,
      expiresAt: row.expires_at,
    };

    await expect(repository.createState(tenantId, input)).resolves.toMatchObject({
      id: row.id,
      workspaceId,
      connector: "zendesk",
    });
    await expect(repository.findState(tenantId, row.id)).resolves.toMatchObject({
      codeVerifier: "verifier",
      redirectUri: row.redirect_uri,
    });
  });

  it("rolls back and releases the client when a query fails", async () => {
    const client = fakeClient((sql) => {
      if (sql.startsWith("INSERT INTO workspace_connector_configs")) {
        throw new Error("write failed");
      }
      return [];
    });
    const repository = new IntegrationRepository(fakePool(client));
    await expect(
      repository.upsertConnectorConfig(tenantId, workspaceId, "zendesk", {
        connector: "zendesk",
        subdomain: "alter-support",
      }),
    ).rejects.toThrow("write failed");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("closes only an owned pool", async () => {
    const client = fakeClient(() => []);
    const pool = fakePool(client);
    await new IntegrationRepository(pool, true).onModuleDestroy();
    expect(pool.end).toHaveBeenCalledOnce();

    const sharedPool = fakePool(client);
    await new IntegrationRepository(sharedPool).onModuleDestroy();
    expect(sharedPool.end).not.toHaveBeenCalled();
  });
});

function fakeClient(
  rowsFor: (sql: string) => readonly Record<string, unknown>[],
): PoolClient {
  return {
    query: vi.fn(async (sql: string) => ({ rows: rowsFor(sql) }) as QueryResult),
    release: vi.fn(),
  } as unknown as PoolClient;
}

function fakePool(client: PoolClient): Pool {
  return {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
  } as unknown as Pool;
}
