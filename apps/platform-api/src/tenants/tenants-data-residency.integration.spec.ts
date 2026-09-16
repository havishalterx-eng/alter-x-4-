import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditEventHandler } from "@alterx/shared-clients";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeEtag } from "../concurrency";
import { TenantResidencyRepository } from "../planner-facade/tenant-residency.repository";
import type { ActorContext } from "../rbac/types";
import { PlatformDb } from "../signup/platform-db";
import { TenantsService } from "./tenants.service";

const databaseUrl = process.env.DATABASE_URL ?? "";

describe.skipIf(!databaseUrl)("TenantsService data residency writer PostgreSQL RLS", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let schemaName: string;
  let roleName: string;
  let recordEvent: ReturnType<typeof vi.fn>;
  let service: TenantsService;
  let reader: TenantResidencyRepository;

  beforeEach(async () => {
    schemaName = `tenant_residency_writer_${randomUUID().replaceAll("-", "_")}`;
    roleName = `tenant_residency_writer_role_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    const sql = readFileSync(
      join(__dirname, "../db/migrations/0000_platform_db_identity_foundation.sql"),
      "utf8",
    );
    for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await admin.query(statement);
    }
    const password = randomUUID();
    await admin.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${roleName}"`);
    await admin.query(`GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA "${schemaName}" TO "${roleName}"`);
    const url = new URL(databaseUrl);
    url.username = roleName;
    url.password = password;
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    recordEvent = vi.fn().mockResolvedValue({});
    service = new TenantsService(new PlatformDb(pool), { recordEvent, getEvent: vi.fn() } as unknown as AuditEventHandler);
    reader = new TenantResidencyRepository(pool);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${roleName}"`);
      await admin.end();
    }
  });

  async function owner(): Promise<ActorContext> {
    const id = randomUUID();
    await admin.query("INSERT INTO tenants (id, name, status) VALUES ($1, 'Residency Tenant', 'active')", [id]);
    return { user_id: randomUUID(), tenant_id: id, roles: ["owner"], permissions: [], session_id: "session" };
  }

  it("writes what the planner's reader enforces, then clears it", async () => {
    const actor = await owner();
    const unpinned = await service.getDataResidency(actor, actor.tenant_id);
    expect(unpinned).toEqual({ data_residency: null });

    const pinned = await service.setDataResidency(
      actor,
      actor.tenant_id,
      { data_residency: { allowed: [" eu ", "de"], legal_basis: "GDPR Art. 44" } },
      computeEtag(unpinned),
    );

    expect(await reader.allowedDataResidency(actor.tenant_id)).toEqual(["eu", "de"]);
    expect(await service.getDataResidency(actor, actor.tenant_id)).toEqual(pinned);
    expect(recordEvent).toHaveBeenCalledTimes(1);

    await service.setDataResidency(actor, actor.tenant_id, { data_residency: null }, computeEtag(pinned));
    expect(await reader.allowedDataResidency(actor.tenant_id)).toEqual([]);
  });

  it("rejects the second of two writers that read the same version", async () => {
    const actor = await owner();
    const etag = computeEtag(await service.getDataResidency(actor, actor.tenant_id));

    await service.setDataResidency(actor, actor.tenant_id, { data_residency: { allowed: ["eu"] } }, etag);
    await expect(
      service.setDataResidency(actor, actor.tenant_id, { data_residency: { allowed: ["us"] } }, etag),
    ).rejects.toMatchObject({ status: 412 });

    expect(await reader.allowedDataResidency(actor.tenant_id)).toEqual(["eu"]);
  });

  it("rolls the write back when the audit event is not recorded", async () => {
    const actor = await owner();
    const etag = computeEtag(await service.getDataResidency(actor, actor.tenant_id));
    recordEvent.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.setDataResidency(actor, actor.tenant_id, { data_residency: { allowed: ["eu"] } }, etag),
    ).rejects.toThrow("audit unavailable");

    expect(await reader.allowedDataResidency(actor.tenant_id)).toEqual([]);
  });
});
