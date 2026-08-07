#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

const platformProofs = [
  "apps/platform-api/src/workflows/workflow.controller.spec.ts",
  "apps/platform-api/src/projects/project.controller.spec.ts",
  "apps/platform-api/src/projects/project-operations.controller.spec.ts",
  "apps/platform-api/src/runs/run.controller.spec.ts",
  "apps/platform-api/src/streaming/stream-gateway.spec.ts",
  "apps/platform-api/src/streaming/membership-revocation.integration.spec.ts",
  "apps/platform-api/src/idempotency/idempotency-store.integration.spec.ts",
  "apps/platform-api/src/action-centre/action-centre.controller.spec.ts",
];

const engineProofs = [
  "apps/orchestration-service/src/template-variables/template-variables.service.spec.ts",
  "apps/orchestration-service/src/clarifications/clarifications.service.spec.ts",
  "apps/orchestration-service/src/approvals/approvals.service.spec.ts",
  "apps/orchestration-service/src/project-read/project-domain.service.spec.ts",
  "apps/orchestration-service/src/runs/run-observability.service.spec.ts",
  "apps/orchestration-service/src/runs/run-stream.integration.spec.ts",
  "apps/orchestration-service/src/registry/nodeexec.service.spec.ts",
  "apps/orchestration-service/src/artifacts/artifacts.service.spec.ts",
];

const contractProofs = ["packages/contracts/src/sse.spec.ts"];

assertMergedProofs([...platformProofs, ...engineProofs, ...contractProofs]);
assertNoDirectEngineBrowserAccess();

run("pnpm", [
  "exec",
  "vitest",
  "run",
  "--config",
  "apps/platform-api/vitest.config.ts",
  ...platformProofs,
]);
run("pnpm", ["exec", "nx", "test-db-integration", "platform-api"]);
run("pnpm", ["exec", "vitest", "run", ...engineProofs, ...contractProofs]);

console.log("Product Core exit harness passed.");

function assertMergedProofs(files) {
  const missing = files.filter((file) => !existsSync(join(root, file)));
  if (missing.length > 0) {
    throw new Error(
      "Product Core exit harness must run only after Fixes 1-5 merge. Missing proof files:\n" +
        missing.map((file) => `- ${file}`).join("\n"),
    );
  }
}

function assertNoDirectEngineBrowserAccess() {
  const browserRoot = join(root, "apps/platform-web");
  const violations = [];
  for (const file of sourceFiles(browserRoot)) {
    const content = readFileSync(file, "utf8");
    if (
      /https?:\/\/[^\s"'`]*(?:engine|orchestration)[^\s"'`]*/i.test(content) ||
      /NEXT_PUBLIC_[A-Z0-9_]*(?:ENGINE|ORCHESTRATION)[A-Z0-9_]*/.test(content)
    ) {
      violations.push(relative(root, file));
    }
  }
  if (violations.length > 0) {
    throw new Error(
      "Browser-facing code must never call Engine directly:\n" +
        violations.map((file) => `- ${file}`).join("\n"),
    );
  }
}

function* sourceFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(path);
    } else if (
      entry.isFile() &&
      /\.(?:[cm]?[jt]sx?)$/.test(entry.name) &&
      statSync(path).size < 1_000_000
    ) {
      yield path;
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}
