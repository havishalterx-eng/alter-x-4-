import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("platform migration journal", () => {
  it("tracks every migration file in execution order", () => {
    const migrations = join(__dirname, "migrations");
    const files = readdirSync(migrations)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => file.replace(/\.sql$/, ""));
    const journal = JSON.parse(
      readFileSync(join(migrations, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };

    expect(journal.entries.map((entry) => entry.tag)).toEqual(files);
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      files.map((_, index) => index),
    );
  });
});
