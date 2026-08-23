import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RegistryRepository } from "./registry.repository";

const databaseUrl = process.env.MARKETPLACE_DATABASE_URL;
const tenantA = "ten_registry_a";
const tenantB = "ten_registry_b";
describe.skipIf(!databaseUrl)("RegistryRepository integration", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let repository: RegistryRepository;
  let schemaName: string;
  let roleName: string;
  beforeEach(async () => {
    schemaName = `registry_${randomUUID().replaceAll("-", "_")}`;
    roleName = `registry_role_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl }); await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    // public stays on the path alongside the private schema: the shared
    // marketplace-migrations' pg_trgm extension is pinned to SCHEMA public
    // (see 0003_search_indexes.sql), so gin_trgm_ops needs to resolve from
    // there regardless of which spec's migration run actually created it.
    await admin.query(`SET search_path TO "${schemaName}", public`);
    // Advisory lock shared with marketplace/publisher/search specs -- CREATE
    // EXTENSION IF NOT EXISTS races on pg_extension under concurrent workers.
    await admin.query("SELECT pg_advisory_lock(729312)");
    try { await migrations(admin); } finally { await admin.query("SELECT pg_advisory_unlock(729312)"); }
    const password = randomUUID(); await admin.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`); await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${roleName}"`); await admin.query(`GRANT USAGE ON SCHEMA public TO "${roleName}"`); await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schemaName}" TO "${roleName}"`);
    const url = new URL(databaseUrl!); url.username = roleName; url.password = password; url.searchParams.set("options", `-c search_path=${schemaName},public`); pool = new pg.Pool({ connectionString: url.toString() }); repository = new RegistryRepository(pool);
  });
  afterEach(async () => { await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await admin.query(`DROP ROLE IF EXISTS "${roleName}"`); await admin.end(); } });
  it("hides tenant draft manifests and reports from other tenants", async () => {
    const manifest = await repository.createManifest(tenantA, `tlm_${randomUUID()}`, { name: "Private", ecosystem: "npm", trust_level: "unverified_private" });
    const version = await repository.createVersion(tenantA, `tlv_${randomUUID()}`, manifest.id, { version: "1.0.0", artifact_ref: "s3://bucket/private.tgz", capabilities: [], permissions: [] });
    await repository.report(tenantA, `scn_${randomUUID()}`, version.id, { verdict: "blocked", findings: [], scannerVersion: "test", durationMs: 0, scannedAt: new Date().toISOString() });
    expect(await repository.get(tenantB, manifest.id)).toBeUndefined(); expect(await repository.latestReport(tenantB, version.id)).toBeUndefined();
  });
  it("denies unscoped reads and tenant write to first-party manifest", async () => {
    const id = `tlm_${randomUUID()}`;
    await admin.query(`INSERT INTO tool_manifests (id, tenant_id, name, ecosystem, trust_level) VALUES ($1, NULL, 'First party', 'npm', 'alter_verified')`, [id]);
    const client = await pool.connect(); try { await client.query("RESET app.current_tenant_id"); expect((await client.query("SELECT * FROM tool_manifests")).rows).toHaveLength(0); await client.query(`SET app.current_tenant_id = '${tenantA}'`); await expect(client.query(`UPDATE tool_manifests SET name = 'bad' WHERE id = $1`, [id])).resolves.toMatchObject({ rowCount: 0 }); } finally { client.release(); }
  });
  it("exposes a published third-party manifest and its versions to other tenants", async () => {
    const manifest = await repository.createManifest(tenantA, `tlm_${randomUUID()}`, { name: "Shared", ecosystem: "npm", trust_level: "community_reviewed" });
    const version = await repository.createVersion(tenantA, `tlv_${randomUUID()}`, manifest.id, { version: "1.0.0", artifact_ref: "s3://bucket/shared.tgz", capabilities: [], permissions: [] });
    await repository.setVersionStatus(tenantA, version.id, "published");
    await repository.setManifestStatus(tenantA, manifest.id, "published");
    expect(await repository.get(tenantB, manifest.id)).toBeDefined();
    expect((await repository.versions(tenantB, manifest.id)).map((item) => item.id)).toContain(version.id);
  });
  it("removes a manifest from catalogue when its final published version is revoked", async () => {
    const manifest = await repository.createManifest(tenantA, `tlm_${randomUUID()}`, { name: "Revoked", ecosystem: "mcp", trust_level: "community_reviewed" });
    const version = await repository.createVersion(tenantA, `tlv_${randomUUID()}`, manifest.id, { version: "1.0.0", artifact_ref: "s3://bucket/revoked.tgz", capabilities: [], permissions: [] });
    await repository.setVersionStatus(tenantA, version.id, "published");
    await repository.setManifestStatus(tenantA, manifest.id, "published");
    await repository.revoke(tenantA, `rvk_${randomUUID()}`, manifest.id, version.id, "Unsafe", "usr_1");
    expect((await repository.list(tenantB)).map((item) => item.id)).not.toContain(manifest.id);
  });
});
async function migrations(client: pg.Client): Promise<void> { const directory = join(__dirname, "../db/marketplace-migrations"); for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) for (const statement of readFileSync(join(directory, file), "utf8").split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await client.query(statement); }
