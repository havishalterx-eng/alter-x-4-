import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATION_MIGRATIONS_PATH } from "./migrations-path";

const migrationFiles = readdirSync(ORCHESTRATION_MIGRATIONS_PATH)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const migrationSql = migrationFiles.map((file) => ({
  file,
  sql: readFileSync(resolve(ORCHESTRATION_MIGRATIONS_PATH, file), "utf8"),
}));

describe("orchestration migration files", () => {
  it("keeps one ordered migration and rollback per ingress table", () => {
    expect(migrationFiles).toEqual([
      "0000_create_workflows.sql",
      "0001_create_triggers.sql",
      "0002_create_trigger_versions.sql",
      "0003_create_conversations.sql",
      "0004_create_events.sql",
      "0005_create_runs.sql",
      "0006_create_conversation_goal_states.sql",
    ]);
    expect(
      readdirSync(resolve(ORCHESTRATION_MIGRATIONS_PATH, "rollback"))
        .filter((file) => file.endsWith(".sql"))
        .sort(),
    ).toEqual([
      "0000_drop_workflows.sql",
      "0001_drop_triggers.sql",
      "0002_drop_trigger_versions.sql",
      "0003_drop_conversations.sql",
      "0004_drop_events.sql",
      "0005_drop_runs.sql",
      "0006_drop_conversation_goal_states.sql",
    ]);
  });

  it.each(migrationSql)(
    "$file forces default-deny RLS and tenant immutability",
    ({ sql }) => {
      expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
      expect(sql).toContain("FORCE ROW LEVEL SECURITY");
      expect(sql).toContain("reject_tenant_id_change()");
      expect(sql).toContain(
        "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid",
      );
      expect(sql).toContain("WITH CHECK");
    },
  );

  it("defines immutability function once and reuses it seven times", () => {
    const allSql = migrationSql.map(({ sql }) => sql).join("\n");

    expect(allSql.match(/CREATE OR REPLACE FUNCTION reject_tenant_id_change/g))
      .toHaveLength(1);
    expect(allSql.match(/EXECUTE FUNCTION reject_tenant_id_change\(\)/g))
      .toHaveLength(7);
  });

  it("contains no cross-database references", () => {
    const allSql = migrationSql.map(({ sql }) => sql).join("\n");

    expect(allSql).not.toMatch(/platform_db|marketplace_db|audit_db/i);
  });

  it("keeps required dedup and relationship constraints", () => {
    const allSql = migrationSql.map(({ sql }) => sql).join("\n");

    expect(allSql).toContain(
      'CREATE UNIQUE INDEX "idx_events_tenant_idempotency"',
    );
    expect(allSql).toContain(
      'CONSTRAINT "triggers_workflow_tenant_fk" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id")',
    );
    expect(allSql).toContain(
      'CONSTRAINT "trigger_versions_trigger_tenant_fk" FOREIGN KEY ("tenant_id", "trigger_id") REFERENCES "triggers"("tenant_id", "id")',
    );
    expect(allSql).toContain(
      'CONSTRAINT "events_trigger_version_tenant_fk" FOREIGN KEY ("tenant_id", "trigger_id", "trigger_version") REFERENCES "trigger_versions"("tenant_id", "trigger_id", "version")',
    );
    expect(allSql).toContain(
      'CONSTRAINT "runs_workflow_tenant_fk" FOREIGN KEY ("tenant_id", "workflow_id") REFERENCES "workflows"("tenant_id", "id")',
    );
    expect(allSql).toContain(
      'CONSTRAINT "conversation_goal_states_conversation_tenant_fk" FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversations"("tenant_id", "id")',
    );
    expect(allSql).toContain(
      'CONSTRAINT "events_payload_or_reference_check" CHECK ("payload" IS NOT NULL OR "payload_reference" IS NOT NULL)',
    );
    expect(allSql).toContain(
      'CONSTRAINT "events_trigger_pair_check" CHECK (("trigger_id" IS NULL AND "trigger_version" IS NULL) OR ("trigger_id" IS NOT NULL AND "trigger_version" IS NOT NULL))',
    );
    expect(allSql).toContain(
      `CONSTRAINT "events_signature_status_check" CHECK ("signature_status" IN ('verified', 'unverified', 'failed'))`,
    );
  });

  it("local bootstrap creates isolated orchestration database ownership", () => {
    const script = readFileSync(
      resolve(process.cwd(), "infrastructure/local/engine-db-init.sh"),
      "utf8",
    );

    expect(script).toContain("CREATE ROLE orchestration_service LOGIN PASSWORD");
    expect(script).toContain(
      "CREATE DATABASE orchestration_db OWNER orchestration_service",
    );
    expect(script).toContain(
      "REVOKE CONNECT, TEMPORARY ON DATABASE orchestration_db FROM PUBLIC",
    );
    expect(script).toContain(
      "GRANT CONNECT, TEMPORARY ON DATABASE orchestration_db TO orchestration_service",
    );
  });
});
