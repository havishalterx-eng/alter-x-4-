import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DbModule } from "./db.module";
import {
  credentialRefs,
  credentialUseAudits,
  entitlements,
  idempotencyKeys,
  onboardingStates,
  tenantMembers,
  tenants,
  userSessions,
  users,
  workspaceMembers,
  workspaces,
} from "./schema";

describe("platform database schema", () => {
  it("exports the database module and all platform tables", () => {
    expect(DbModule).toBeDefined();
    expect(
      [
        entitlements,
        credentialRefs,
        credentialUseAudits,
        idempotencyKeys,
        onboardingStates,
        tenantMembers,
        tenants,
        userSessions,
        users,
        workspaceMembers,
        workspaces,
      ].map(getTableName),
    ).toEqual([
      "entitlements",
      "credential_refs",
      "credential_use_audits",
      "idempotency_keys",
      "onboarding_states",
      "tenant_members",
      "tenants",
      "user_sessions",
      "users",
      "workspace_members",
      "workspaces",
    ]);
  });

  it("defines tenant ownership columns on tenant-scoped tables", () => {
    const foreignKeyNames: string[] = [];

    for (const table of [
      entitlements,
      credentialRefs,
      credentialUseAudits,
      idempotencyKeys,
      tenantMembers,
      workspaceMembers,
      workspaces,
    ]) {
      expect(getTableColumns(table)).toHaveProperty("tenantId");
      foreignKeyNames.push(
        ...getTableConfig(table).foreignKeys.map((foreignKey) =>
          foreignKey.getName(),
        ),
      );
    }

    expect(foreignKeyNames).toHaveLength(11);
    expect(getTableConfig(idempotencyKeys).indexes).toHaveLength(2);
    expect(getTableColumns(credentialRefs)).not.toHaveProperty("value");
    expect(getTableColumns(credentialRefs)).not.toHaveProperty("secret");
    expect(getTableConfig(workspaces).indexes).toHaveLength(2);
    expect(getTableConfig(tenantMembers).indexes).toHaveLength(1);
    expect(getTableConfig(workspaceMembers).indexes).toHaveLength(1);
  });

  it("defines onboarding and session tenant constraints", () => {
    expect(getTableColumns(onboardingStates)).toHaveProperty("tenantId");
    expect(getTableConfig(onboardingStates).indexes).toHaveLength(1);
    expect(
      getTableConfig(onboardingStates).foreignKeys.map((foreignKey) =>
        foreignKey.getName(),
      ),
    ).toHaveLength(3);

    expect(getTableColumns(userSessions)).toHaveProperty("tenantId");
    expect(
      getTableConfig(userSessions).foreignKeys.map((foreignKey) =>
        foreignKey.getName(),
      ),
    ).toHaveLength(2);
  });
});
