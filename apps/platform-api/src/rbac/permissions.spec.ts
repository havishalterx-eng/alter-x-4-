import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "./permissions";

describe("permissionsForRoles", () => {
  it("returns no permissions for an unknown or empty role set", () => {
    expect(permissionsForRoles([])).toEqual([]);
    expect(permissionsForRoles(["not-a-role"])).toEqual([]);
  });

  it("grants a tenant role's own permissions", () => {
    expect(permissionsForRoles(["member"])).toEqual(["credential:read"]);
  });

  it("applies tenant-role rank closure: owner inherits admin's tenant-scoped grants", () => {
    // "admin" is also a workspace role, so its full grant list includes
    // workspace-only permissions (e.g. approvals:decide) that tenant
    // "owner" -- a different axis entirely -- must not inherit. Only the
    // tenant-axis grants (credential:*, billing:*, knowledge:admin) close
    // upward by rank.
    const ownerPerms = permissionsForRoles(["owner"]);
    for (const permission of ["credential:write", "credential:delete", "billing:read", "knowledge:admin"]) {
      expect(ownerPerms).toContain(permission);
    }
    // owner-only grant that lower-ranked tenant "admin" must NOT have
    expect(ownerPerms).toContain("billing:write");
    expect(permissionsForRoles(["admin"])).not.toContain("billing:write");
  });

  it("does not apply rank closure across workspace roles (exact match only)", () => {
    // "viewer" is the lowest workspace role and must not inherit "admin"'s
    // workspace-scoped write permissions.
    expect(permissionsForRoles(["viewer"])).not.toContain("projects:write");
  });

  it("unions permissions across multiple held roles", () => {
    const perms = permissionsForRoles(["member", "editor"]);
    expect(perms).toEqual(expect.arrayContaining(["credential:read", "projects:write"]));
  });
});
