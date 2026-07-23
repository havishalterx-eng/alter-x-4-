import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { DbModule } from "./db.module";
import {
  entitlements,
  tenantMembers,
  tenants,
  users,
  workspaceMembers,
  workspaces,
} from "./schema";

describe("platform database schema", () => {
  it("exports the database module and all identity tables", () => {
    expect(DbModule).toBeDefined();
    expect(
      [
        entitlements,
        tenantMembers,
        tenants,
        users,
        workspaceMembers,
        workspaces,
      ].map(getTableName),
    ).toEqual([
      "entitlements",
      "tenant_members",
      "tenants",
      "users",
      "workspace_members",
      "workspaces",
    ]);
  });

  it("defines tenant ownership columns on tenant-scoped tables", () => {
    const foreignKeyNames: string[] = [];

    for (const table of [
      entitlements,
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

    expect(foreignKeyNames).toHaveLength(7);
    expect(getTableConfig(workspaces).indexes).toHaveLength(2);
    expect(getTableConfig(tenantMembers).indexes).toHaveLength(1);
    expect(getTableConfig(workspaceMembers).indexes).toHaveLength(1);
  });
});
