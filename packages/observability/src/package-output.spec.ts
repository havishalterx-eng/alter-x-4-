import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("@alterx/observability package output", () => {
  it("loads initObservability from a plain Node process after build", () => {
    const builtEntryPoint = resolve(
      process.cwd(),
      "packages/observability/dist/index.js",
    );
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `const pkg = require(${JSON.stringify(builtEntryPoint)}); if (typeof pkg.initObservability !== "function") process.exit(2); process.stdout.write("function"); process.exit(0);`,
      ],
      { encoding: "utf8" },
    );

    expect(output).toBe("function");
  }, 20_000);

  it("loads the observability adapter subpath from a plain Node process", () => {
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `const pkg = require("@alterx/adapters/observability"); if (typeof pkg.createObservabilityProvider !== "function") process.exit(2); process.stdout.write("function"); process.exit(0);`,
      ],
      { encoding: "utf8", cwd: process.cwd() },
    );

    expect(output).toBe("function");
  }, 20_000);
});
