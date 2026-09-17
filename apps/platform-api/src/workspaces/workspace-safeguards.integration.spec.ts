import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditEventHandler } from "@alterx/shared-clients";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeEtag } from "../concurrency";
import type { ActorContext } from "../rbac/types";
import { PlatformDb } from "../signup/platform-db";
import { WorkspaceSafeguardsService } from "./workspace-safeguards.service";

const databaseUrl = process.env.DATABASE_URL ?? "";
const migrationsPath = join(__dirname, "../db/migrations");
const defaults = { contains_pii: true, approve_external_actions: true };

function statements(files: string[]): string[] {
  return files
    .map((file) => readFileSync(join(migrationsPath, file), "utf8"))
    .join("\n--> statement-breakpoint\n")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe.skipIf(!databaseUrl)("WorkspaceSafeguardsService PostgreSQL RLS", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let schemaName: string;
  let roleName: string;
  let recordEvent: ReturnType<typeof vi.fn>;
  let service: WorkspaceSafeguardsService;

  beforeEach(async () => {
    schemaName = `workspace_safeguards_${randomUUID().replaceAll("-", "_")}`;
    roleName = `workspace_safeguards_role_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    for (const statement of statements(["0000_platform_db_identity_foundation.sql"])) {
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
    service = new WorkspaceSafeguardsService(
      new PlatformDb(pool),
      { recordEvent, getEvent: vi.fn() } as unknown as AuditEventHandler,
    );
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${roleName}"`);
      await admin.end();
    }
  });

  async function tenantWithWorkspace(): Promise<{ actor: ActorContext; workspaceId: string }> {
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    await admin.query("INSERT INTO tenants (id, name, status) VALUES ($1, 'Safeguards Tenant', 'active')", [tenantId]);
    await admin.query("INSERT INTO workspaces (id, tenant_id, name, status) VALUES ($1, $2, 'Default', 'active')", [
      workspaceId,
      tenantId,
    ]);
    return {
      actor: { user_id: randomUUID(), tenant_id: tenantId, roles: ["owner"], permissions: [], session_id: "session" },
      workspaceId,
    };
  }

  // 0019 needs nothing but the workspaces table from 0000, so the two are enough; the
  // full chain runs in db.migration.spec.ts.
  async function migrateTo0019(): Promise<void> {
    for (const statement of statements(["0019_workspace_safeguards.sql"])) {
      await admin.query(statement);
    }
  }

  it("gives an existing workspace both safeguards on, and new workspaces too", async () => {
    const existing = await tenantWithWorkspace();
    await migrateTo0019();
    const created = await tenantWithWorkspace();

    expect(await service.get(existing.actor, existing.workspaceId)).toEqual({ safeguards: defaults });
    expect(await service.get(created.actor, created.workspaceId)).toEqual({ safeguards: defaults });
  });

  it("writes and reads back, and rejects the second of two writers on one ETag", async () => {
    await migrateTo0019();
    const { actor, workspaceId } = await tenantWithWorkspace();
    const etag = computeEtag(await service.get(actor, workspaceId));
    const off = { safeguards: { contains_pii: false, approve_external_actions: true } };

    await service.set(actor, workspaceId, off, etag);
    await expect(
      service.set(actor, workspaceId, { safeguards: { ...defaults, approve_external_actions: false } }, etag),
    ).rejects.toMatchObject({ status: 412 });

    expect(await service.get(actor, workspaceId)).toEqual(off);
    expect(recordEvent).toHaveBeenCalledTimes(1);
  });

  it("rolls the write back when the audit event is not recorded", async () => {
    await migrateTo0019();
    const { actor, workspaceId } = await tenantWithWorkspace();
    const etag = computeEtag(await service.get(actor, workspaceId));
    recordEvent.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.set(actor, workspaceId, { safeguards: { contains_pii: false, approve_external_actions: false } }, etag),
    ).rejects.toThrow("audit unavailable");

    expect(await service.get(actor, workspaceId)).toEqual({ safeguards: defaults });
  });

  it("never reads or writes another tenant's workspace", async () => {
    await migrateTo0019();
    const mine = await tenantWithWorkspace();
    const theirs = await tenantWithWorkspace();

    await expect(service.get(mine.actor, theirs.workspaceId)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.set(
        mine.actor,
        theirs.workspaceId,
        { safeguards: { contains_pii: false, approve_external_actions: false } },
        "*",
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(await service.get(theirs.actor, theirs.workspaceId)).toEqual({ safeguards: defaults });
  });

  it("refuses a stored shape the API would reject", async () => {
    await migrateTo0019();
    const { workspaceId } = await tenantWithWorkspace();
    await expect(
      admin.query("UPDATE workspaces SET safeguards = $1 WHERE id = $2", [
        JSON.stringify({ contains_pii: true }),
        workspaceId,
      ]),
    ).rejects.toThrow(/workspaces_safeguards_shape/);
    await expect(
      admin.query("UPDATE workspaces SET safeguards = $1 WHERE id = $2", [
        JSON.stringify({ ...defaults, verification_required: true }),
        workspaceId,
      ]),
    ).rejects.toThrow(/workspaces_safeguards_shape/);
  });
});
