import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PgIdempotencyStore } from "./idempotency-store";

const databaseUrl = process.env.DATABASE_URL ?? "";
const tenantA = "00000000-0000-7000-8000-000000000001";
const tenantB = "00000000-0000-7000-8000-000000000002";

describe.skipIf(!databaseUrl)("PgIdempotencyStore PostgreSQL RLS", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let store: PgIdempotencyStore;
  let schemaName: string;
  let roleName: string;

  beforeEach(async () => {
    schemaName = `idem_${randomUUID().replaceAll("-", "_")}`;
    roleName = `idem_role_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    await admin.query(`SET search_path TO "${schemaName}"`);
    await applyMigrations(admin);
    await admin.query(
      `INSERT INTO tenants (id, name, status)
       VALUES ($1, 'Tenant A', 'active'), ($2, 'Tenant B', 'active')`,
      [tenantA, tenantB],
    );

    const password = randomUUID();
    await admin.query(
      `CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}'`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA "${schemaName}" TO "${roleName}"`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE
       ON ALL TABLES IN SCHEMA "${schemaName}" TO "${roleName}"`,
    );
    const rlsUrl = new URL(databaseUrl);
    rlsUrl.username = roleName;
    rlsUrl.password = password;
    rlsUrl.searchParams.set("options", `-c search_path=${schemaName}`);
    pool = new pg.Pool({ connectionString: rlsUrl.toString(), max: 4 });
    store = new PgIdempotencyStore(pool, 60_000);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.query(`DROP ROLE IF EXISTS "${roleName}"`);
      await admin.end();
    }
  });

  it("stores/replays within tenant and isolates same key across tenants", async () => {
    const firstA = await store.execute(
      {
        tenantId: tenantA,
        key: "shared-key",
        fingerprint: "tenant-a-hash",
        instance: "/api/v1/workflows",
      },
      async () => ({ status: 201, body: { owner: "tenant-a" } }),
    );
    const replayA = await store.execute(
      {
        tenantId: tenantA,
        key: "shared-key",
        fingerprint: "tenant-a-hash",
        instance: "/api/v1/workflows",
      },
      async () => {
        throw new Error("replay executed");
      },
    );
    const firstB = await store.execute(
      {
        tenantId: tenantB,
        key: "shared-key",
        fingerprint: "tenant-b-hash",
        instance: "/api/v1/workflows",
      },
      async () => ({ status: 202, body: { owner: "tenant-b" } }),
    );

    expect(firstA.replayed).toBe(false);
    expect(replayA).toMatchObject({
      replayed: true,
      body: { owner: "tenant-a" },
    });
    expect(firstB).toMatchObject({
      replayed: false,
      body: { owner: "tenant-b" },
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [tenantA],
      );
      const visible = await client.query<{ tenant_id: string }>(
        "SELECT tenant_id FROM idempotency_keys",
      );
      expect(visible.rows).toEqual([{ tenant_id: tenantA }]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });

  it("collapses concurrent duplicates into one operation", async () => {
    let release!: () => void;
    let started!: () => void;
    const operationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const operation = vi.fn(
      () =>
        new Promise<{ status: number; body: unknown }>((resolve) => {
          started();
          release = () =>
            resolve({ status: 201, body: { id: "workflow-1" } });
        }),
    );
    const input = {
      tenantId: tenantA,
      key: "concurrent-key",
      fingerprint: "same-hash",
      instance: "/api/v1/workflows",
    };

    const first = store.execute(input, operation);
    await operationStarted;
    const second = store.execute(input, operation);
    release();

    const results = await Promise.all([first, second]);
    expect(operation).toHaveBeenCalledOnce();
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
  });
});

async function applyMigrations(client: pg.Client): Promise<void> {
  const directory = join(__dirname, "../db/migrations");
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
