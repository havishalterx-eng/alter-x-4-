import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarketplaceRepository } from "./marketplace.repository";
import type { ListingCompatibility } from "./types";

const databaseUrl = process.env.MARKETPLACE_DATABASE_URL ?? "";
const tenantA = "ten_00000000-0000-7000-8000-000000000001";
const tenantB = "ten_00000000-0000-7000-8000-000000000002";
const workspaceA = "ws_00000000-0000-7000-8000-000000000001";

const compatibility: ListingCompatibility = {
  dagSchemaVersion: "1.0.0",
  nodeTypes: [],
  connectorCapabilities: [],
  requiredEntitlements: [],
};

function listingId(): string {
  return `lst_${randomUUID()}`;
}

describe.skipIf(!databaseUrl)("MarketplaceRepository PostgreSQL RLS", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let repository: MarketplaceRepository;
  let schemaName: string;
  let roleName: string;

  beforeEach(async () => {
    schemaName = `marketplace_${randomUUID().replaceAll("-", "_")}`;
    roleName = `marketplace_role_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    // CREATE EXTENSION IF NOT EXISTS is not safe under true concurrent
    // execution -- multiple integration-spec files run in parallel vitest
    // workers against the same physical database and can race on the
    // shared pg_extension catalog row for pg_trgm. Serialize with a fixed
    // advisory lock key shared by every caller of applyMigrations/
    // migrations() across marketplace/publisher/registry/search specs.
    await admin.query("SELECT pg_advisory_lock(729312)");
    try {
      await applyMigrations(admin);
    } finally {
      await admin.query("SELECT pg_advisory_unlock(729312)");
    }
    const password = randomUUID();
    await admin.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`);
    await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${roleName}"`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES
       IN SCHEMA "${schemaName}" TO "${roleName}"`,
    );
    const url = new URL(databaseUrl);
    url.username = roleName;
    url.password = password;
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    pool = new pg.Pool({ connectionString: url.toString() });
    repository = new MarketplaceRepository(pool);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${roleName}"`);
      await admin.end();
    }
  });

  // Spec 12 — a draft listing owned by tenant A is invisible to tenant B.
  it("hides another tenant's draft listing from the catalogue", async () => {
    const id = listingId();
    await repository.createListing(tenantA, id, {
      type: "workflow_template",
      name: "Tenant A draft",
      license_type: "single_workspace",
    });

    expect(await repository.findListing(tenantA, id)).toBeDefined();
    expect(await repository.findListing(tenantB, id)).toBeUndefined();

    const forB = await repository.listListings(tenantB, { limit: 50 });
    expect(forB.data.map((row) => row.id)).not.toContain(id);
  });

  it("exposes a published listing to every tenant", async () => {
    const id = listingId();
    await repository.createListing(tenantA, id, {
      type: "agent",
      name: "Shared agent",
      license_type: "tenant_wide",
    });
    await repository.updateListing(tenantA, id, { status: "published" });

    expect(await repository.findListing(tenantB, id)).toBeDefined();
  });

  it("hides unreleased versions from non-owners while retaining them for the owner", async () => {
    const id = listingId();
    await repository.createListing(tenantA, id, {
      type: "agent",
      name: "Versioned shared agent",
      license_type: "tenant_wide",
    });
    await repository.updateListing(tenantA, id, { status: "published" });
    const released = await repository.createVersion(tenantA, `lsv_${randomUUID()}`, id, {
      version: "1.0.0",
      payload_ref: "s3://bucket/released.json",
      compatibility,
    });
    const unreleased = await repository.createVersion(tenantA, `lsv_${randomUUID()}`, id, {
      version: "2.0.0",
      payload_ref: "s3://bucket/unreleased.json",
      compatibility,
    });
    await admin.query(
      "UPDATE listing_versions SET published_at = clock_timestamp() WHERE id = $1",
      [released.id],
    );

    expect((await repository.listVersions(tenantB, id)).map((row) => row.id)).toEqual([
      released.id,
    ]);
    expect((await repository.listVersions(tenantA, id)).map((row) => row.id)).toEqual(
      expect.arrayContaining([released.id, unreleased.id]),
    );
  });

  // Spec 13 — installs never leak across tenants.
  it("scopes installs to the installing tenant", async () => {
    const id = listingId();
    await repository.createListing(tenantA, id, {
      type: "workflow_template",
      name: "Installable",
      license_type: "single_workspace",
    });
    await repository.updateListing(tenantA, id, { status: "published" });
    const version = await repository.createVersion(
      tenantA,
      `lsv_${randomUUID()}`,
      id,
      {
        version: "1.0.0",
        payload_ref: "s3://bucket/template.json",
        compatibility,
      },
    );
    await repository.createInstall(
      tenantA,
      `ins_${randomUUID()}`,
      workspaceA,
      id,
      version.id,
      "s3://bucket/tenants/a/template.json",
      "single_workspace",
      randomUUID(),
    );

    expect(await repository.listAssets(tenantA)).toHaveLength(1);
    expect(await repository.listAssets(tenantB)).toHaveLength(0);
    expect(await repository.findInstallForListing(tenantB, id)).toBeNull();
  });

  // Spec 14 — RLS holds without the application-level tenant filter.
  it("denies unscoped reads at the database layer", async () => {
    const id = listingId();
    await repository.createListing(tenantA, id, {
      type: "tool",
      name: "Private tool",
      license_type: "single_workspace",
    });
    const version = await repository.createVersion(
      tenantA,
      `lsv_${randomUUID()}`,
      id,
      {
        version: "1.0.0",
        payload_ref: "s3://bucket/tool.json",
        compatibility,
      },
    );
    await repository.createInstall(
      tenantA,
      `ins_${randomUUID()}`,
      workspaceA,
      id,
      version.id,
      "s3://bucket/tenants/a/tool.json",
      "single_workspace",
      randomUUID(),
    );

    const client = await pool.connect();
    try {
      // No WHERE tenant_id anywhere below: only RLS stands between the query
      // and another tenant's rows.
      await client.query("RESET app.current_tenant_id");
      expect((await client.query("SELECT * FROM installs")).rows).toHaveLength(0);

      await client.query(`SET app.current_tenant_id = '${tenantB}'`);
      expect((await client.query("SELECT * FROM installs")).rows).toHaveLength(0);
      expect((await client.query("SELECT * FROM listings")).rows).toHaveLength(0);

      await client.query(`SET app.current_tenant_id = '${tenantA}'`);
      expect((await client.query("SELECT * FROM installs")).rows).toHaveLength(1);
      expect((await client.query("SELECT * FROM listings")).rows).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  // Spec 15 — first-party rows are writable by no tenant through this path.
  it("refuses tenant writes to first-party listings", async () => {
    const id = listingId();
    const client = await pool.connect();
    try {
      await client.query(`SET app.current_tenant_id = '${tenantA}'`);
      await expect(
        client.query(
          `INSERT INTO listings (id, tenant_id, type, name, license_type, status)
           VALUES ($1, NULL, 'agent', 'First party', 'tenant_wide', 'published')`,
          [id],
        ),
      ).rejects.toThrow();
    } finally {
      client.release();
    }

    await admin.query(
      `INSERT INTO listings (id, tenant_id, type, name, license_type, status)
       VALUES ($1, NULL, 'agent', 'First party', 'tenant_wide', 'published')`,
      [id],
    );

    const tenantClient = await pool.connect();
    try {
      await tenantClient.query(`SET app.current_tenant_id = '${tenantA}'`);
      expect(
        (await tenantClient.query("SELECT * FROM listings WHERE id = $1", [id]))
          .rows,
      ).toHaveLength(1);
      const updated = await tenantClient.query(
        "UPDATE listings SET name = 'hijacked' WHERE id = $1 RETURNING *",
        [id],
      );
      expect(updated.rows).toHaveLength(0);
    } finally {
      tenantClient.release();
    }
  });

  // Spec 16 — cursor pagination is stable and bounded.
  it("paginates listings without duplicates or gaps", async () => {
    const created: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const id = listingId();
      await repository.createListing(tenantA, id, {
        type: "workflow_template",
        name: `Listing ${index}`,
        license_type: "single_workspace",
      });
      created.push(id);
    }

    const first = await repository.listListings(tenantA, { limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const last = first.data[first.data.length - 1]!;
    const second = await repository.listListings(
      tenantA,
      { limit: 2 },
      { createdAt: last.createdAt.toISOString(), id: last.id },
    );
    expect(second.data).toHaveLength(2);

    const seen = [...first.data, ...second.data].map((row) => row.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(created).toEqual(expect.arrayContaining(seen));
  });
});

async function applyMigrations(client: pg.Client): Promise<void> {
  const directory = join(__dirname, "../db/marketplace-migrations");
  const sql = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(directory, file), "utf8"))
    .join("\n--> statement-breakpoint\n");
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    await client.query(statement);
  }
}
