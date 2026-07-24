import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  InMemorySsoConfigStore,
  normalizedSsoConfig,
  PgSsoConfigStore,
} from "./sso-config-store";

const tenantId = "00000000-0000-7000-8000-000000000001";

describe("SSO config stores", () => {
  it("normalizes reference-only SAML and OIDC configs", () => {
    expect(
      normalizedSsoConfig({
        type: "saml",
        metadataUrl: "https://idp.test/metadata",
        entityId: "entity",
        certificateRef: "secret/certificate",
      }),
    ).toEqual({
      type: "saml",
      metadataUrl: "https://idp.test/metadata",
      entityId: "entity",
      certificateRef: "secret/certificate",
    });
    expect(normalizedSsoConfig({ type: "saml" })).toEqual({ type: "saml" });
    expect(
      normalizedSsoConfig({
        type: "oidc",
        issuer: "https://idp.test",
        clientId: "client",
      }),
    ).toEqual({ type: "oidc", issuer: "https://idp.test", clientId: "client" });
  });

  it("stores in-memory config per tenant", async () => {
    const store = new InMemorySsoConfigStore();
    const config = { type: "saml" as const, entityId: "entity" };
    await store.save(tenantId, config);
    expect(store.get(tenantId)).toEqual(config);
    expect(store.get("missing")).toBeUndefined();
  });

  it("sets tenant context and commits PostgreSQL persistence", async () => {
    const harness = pgSsoHarness(1);
    const config = { type: "saml" as const, entityId: "entity" };
    await new PgSsoConfigStore(harness.pool).save(tenantId, config);
    expect(harness.query).toHaveBeenCalledWith(
      "SELECT set_config('app.current_tenant_id', $1, true)",
      [tenantId],
    );
    expect(harness.query).toHaveBeenCalledWith(
      "UPDATE tenants SET sso_config = $1 WHERE id = $2",
      [config, tenantId],
    );
    expect(harness.query).toHaveBeenCalledWith("COMMIT");
    expect(harness.release).toHaveBeenCalled();
  });

  it("rolls back when tenant is unavailable", async () => {
    const harness = pgSsoHarness(0);
    await expect(
      new PgSsoConfigStore(harness.pool).save(tenantId, {
        type: "saml",
      }),
    ).rejects.toThrow("Tenant unavailable for SSO configuration");
    expect(harness.query).toHaveBeenCalledWith("ROLLBACK");
    expect(harness.release).toHaveBeenCalled();
  });
});

function pgSsoHarness(rowCount: number): {
  pool: pg.Pool;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (sql: string) =>
    sql.startsWith("UPDATE tenants") ? { rowCount } : {},
  );
  const release = vi.fn();
  return {
    pool: {
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as pg.Pool,
    query,
    release,
  };
}
