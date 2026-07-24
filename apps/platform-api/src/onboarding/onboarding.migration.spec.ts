import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "apps/platform-api/src/db/migrations/0003_onboarding_states.sql",
  ),
  "utf8",
);

describe("onboarding migration", () => {
  it("creates tenant-owned state with RLS, unique workspace, and immutability", () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "onboarding_states"');
    expect(migration).toContain('"tenant_id" uuid NOT NULL');
    expect(migration).toContain('"workspace_id" uuid NOT NULL REFERENCES "workspaces"');
    expect(migration).toContain("onboarding_states_workspace_id_unique");
    expect(migration).toContain("onboarding_states_tenant_workspace_fk");
    expect(migration).toContain('ALTER TABLE "onboarding_states" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("onboarding_states_tenant_context_isolation");
    expect(migration).toContain("prevent_tenant_id_update");
  });
});
