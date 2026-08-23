import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublisherRepository } from "./publisher.repository";

const databaseUrl = process.env.MARKETPLACE_DATABASE_URL ?? "";
const tenantId = "ten_018f47a5-7b2c-7d10-8f11-1234567890ab";

describe.skipIf(!databaseUrl)("PublisherRepository PostgreSQL", () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let repository: PublisherRepository;
  let schemaName: string;

  beforeEach(async () => {
    schemaName = `publisher_${randomUUID().replaceAll("-", "_")}`;
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    // public stays on the path alongside the private schema: the shared
    // marketplace-migrations' pg_trgm extension is pinned to SCHEMA public
    // (see 0003_search_indexes.sql), so gin_trgm_ops needs to resolve from
    // there regardless of which spec's migration run actually created it.
    await admin.query(`SET search_path TO "${schemaName}", public`);
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
    const url = new URL(databaseUrl);
    url.searchParams.set("options", `-c search_path=${schemaName},public`);
    pool = new pg.Pool({ connectionString: url.toString() });
    repository = new PublisherRepository(pool);
  });

  afterEach(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`); await admin.end(); }
  });

  it("queues KYC, approval verifies publisher, rejection leaves publisher unverified", async () => {
    const pending = await repository.createSubmission(tenantId, `pub_${randomUUID()}`, `kyc_${randomUUID()}`, [
      { type: "tax_id", objectRef: "s3://private/tax" }, { type: "bank_proof", objectRef: "s3://private/bank" },
    ]);
    expect(pending.status).toBe("pending_review");
    await expect(repository.reviewSubmission(tenantId, pending.id, "usr_staff", "approved", null)).resolves.toMatchObject({ status: "approved" });
    await expect(repository.getPublisher(tenantId)).resolves.toMatchObject({ verificationStatus: "verified" });

    const rejected = await repository.createSubmission(tenantId, `pub_${randomUUID()}`, `kyc_${randomUUID()}`, [
      { type: "tax_id", objectRef: "s3://private/tax-2" }, { type: "bank_proof", objectRef: "s3://private/bank-2" },
    ]);
    await expect(repository.reviewSubmission(tenantId, rejected.id, "usr_staff", "rejected", "Document mismatch")).resolves.toMatchObject({ status: "rejected", rejectionReason: "Document mismatch" });
    await expect(repository.getPublisher(tenantId)).resolves.toMatchObject({ verificationStatus: "rejected" });
  });

  it("database rejects payout ledger updates", async () => {
    const publisher = await repository.createSubmission(tenantId, `pub_${randomUUID()}`, `kyc_${randomUUID()}`, [
      { type: "tax_id", objectRef: "s3://private/tax" }, { type: "bank_proof", objectRef: "s3://private/bank" },
    ]);
    const publisherRow = await repository.getPublisher(tenantId);
    const listingId = `lst_${randomUUID()}`;
    const versionId = `lsv_${randomUUID()}`;
    const orderId = `ord_${randomUUID()}`;
    const payoutId = `pay_${randomUUID()}`;
    const ledgerId = `led_${randomUUID()}`;
    await admin.query("SELECT set_config('app.current_tenant_id', $1, false)", [tenantId]);
    await admin.query(`INSERT INTO listings (id, tenant_id, type, name, license_type, status) VALUES ($1, $2, 'agent', 'Ledger test', 'tenant_wide', 'published')`, [listingId, tenantId]);
    await admin.query(`INSERT INTO listing_versions (id, listing_id, version, payload_ref, compatibility_json) VALUES ($1, $2, '1.0.0', 's3://private/payload', '{}'::jsonb)`, [versionId, listingId]);
    await admin.query(`INSERT INTO orders (id, tenant_id, listing_id, listing_version_id, amount_minor, currency, status, idempotency_key) VALUES ($1, $2, $3, $4, 10005, 'INR', 'paid', $5)`, [orderId, tenantId, listingId, versionId, randomUUID()]);
    await admin.query(`INSERT INTO payouts (id, tenant_id, order_id, publisher_id, total_minor, seller_share_minor, platform_share_minor, status) VALUES ($1, $2, $3, $4, 10005, 8004, 2001, 'created')`, [payoutId, tenantId, orderId, publisherRow!.id]);
    await admin.query(`INSERT INTO payout_ledger (id, tenant_id, payout_id, entry_type, amount_minor) VALUES ($1, $2, $3, 'payout_created', 8004)`, [ledgerId, tenantId, payoutId]);
    await expect(admin.query("UPDATE payout_ledger SET amount_minor = 1 WHERE id = $1", [ledgerId])).rejects.toThrow("payout_ledger is append-only");
    expect(publisher.id).toContain("kyc_");
  });
});

async function applyMigrations(client: pg.Client): Promise<void> {
  const directory = join(__dirname, "../db/marketplace-migrations");
  const sql = readdirSync(directory).filter((file) => file.endsWith(".sql")).sort().map((file) => readFileSync(join(directory, file), "utf8")).join("\n--> statement-breakpoint\n");
  for (const statement of sql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) await client.query(statement);
}
