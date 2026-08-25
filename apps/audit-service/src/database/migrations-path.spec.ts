import { afterEach, describe, expect, it, vi } from "vitest";

describe("AUDIT_MIGRATIONS_PATH", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("resolves to the workspace-relative drizzle directory when it exists", async () => {
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      existsSync: () => true,
    }));
    vi.resetModules();
    const { AUDIT_MIGRATIONS_PATH } = await import("./migrations-path.js");
    expect(AUDIT_MIGRATIONS_PATH).toContain("apps/audit-service/drizzle");
  });

  it("falls back to the built-relative drizzle directory when the workspace path does not exist", async () => {
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      existsSync: () => false,
    }));
    vi.resetModules();
    const { AUDIT_MIGRATIONS_PATH } = await import("./migrations-path.js");
    expect(AUDIT_MIGRATIONS_PATH).toContain("drizzle");
    expect(AUDIT_MIGRATIONS_PATH).not.toContain("apps/audit-service/drizzle");
  });
});
