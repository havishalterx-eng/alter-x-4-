import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("@alterx/contracts built package", () => {
  it("loads built runtime exports in a plain Node subprocess", () => {
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `
          const { resolve } = require("node:path");
          const packageRoot = resolve(process.cwd(), "packages/contracts");
          const expectedEntry = resolve(packageRoot, "dist/index.js");
          if (require.resolve(packageRoot) !== expectedEntry) process.exit(1);
          const builtPackage = require(packageRoot);
          for (const name of [
            "CanonicalEventSchema",
            "CompiledDagSchema",
            "WorkflowDagCompiledSchema",
            "SseEnvelopeSchema",
          ]) {
            if (!(name in builtPackage)) process.exit(2);
          }
          process.stdout.write("built package import ok");
        `,
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(output).toBe("built package import ok");
  });
});
