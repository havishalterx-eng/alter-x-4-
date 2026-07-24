import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("@alterx/adapters package output", () => {
  it("loads from a plain Node process after a clean build", () => {
    const builtEntryPoint = resolve(
      process.cwd(),
      "packages/adapters/dist/index.js",
    );
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `const adapters = require(${JSON.stringify(builtEntryPoint)}); for (const name of ["TemporalDurableExecutionProvider", "PostgresAuditStoreProvider", "AuditGrpcController", "AwsSecretsManagerProvider"]) { if (typeof adapters[name] !== "function") process.exit(2); } process.stdout.write("function");`,
      ],
      { encoding: "utf8" },
    );

    expect(output).toBe("function");
  });
});
