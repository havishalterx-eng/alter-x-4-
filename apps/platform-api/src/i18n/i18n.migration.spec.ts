import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("i18n migration", () => {
  it("adds only additive preferences and seeds minimal EN and HI product copy", () => {
    const sql = readFileSync(
      join(__dirname, "../db/migrations/0010_i18n.sql"),
      "utf8",
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "i18n_bundles"');
    expect(sql).toContain("('en', 'ui', 'language.english', 'English')");
    expect(sql).toContain("('hi', 'ui', 'language.hindi', 'हिन्दी')");
    expect(sql).toContain('ALTER TABLE "users"\nADD COLUMN IF NOT EXISTS "preferred_language"');
    expect(sql).toContain('ALTER TABLE "workspaces"\nADD COLUMN IF NOT EXISTS "default_language"');
    expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|RENAME\s+/i);
  });
});
