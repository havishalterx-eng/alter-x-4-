import { createMockSandboxProvider } from "@alterx/shared-clients";
import { describe, expect, it } from "vitest";
import { SandboxService } from "./sandbox.service";

const SESSION = "ses_mock-1";

async function service(): Promise<SandboxService> {
  const sandbox = createMockSandboxProvider();
  await sandbox.createSession({ tenantId: "ten_1", runId: "run_1", cycleId: "cycle_1", templateId: "base", environment: {} });
  return new SandboxService(sandbox);
}

describe("SandboxService", () => {
  it("executes commands and manages files only within the workspace", async () => {
    const target = await service();
    await target.writeFiles(SESSION, [{ path: "/workspace/project/package.json", content: "{}" }]);
    await expect(target.readFile(SESSION, "/workspace/project/package.json")).resolves.toBe("{}");
    await expect(target.execute(SESSION, "pnpm install")).resolves.toMatchObject({ exitCode: 0 });
  });

  it("installs packages only through supported package managers", async () => {
    const target = await service();
    await expect(target.installPackage(SESSION, "pnpm", "zod")).resolves.toMatchObject({ exitCode: 0 });
    await expect(target.installPackage(SESSION, "apt", "curl")).rejects.toThrow("Package manager");
  });

  it("rejects workspace escapes and destructive commands", async () => {
    const target = await service();
    await expect(target.readFile(SESSION, "/workspace/../secret")).rejects.toThrow("workspace");
    await expect(target.execute(SESSION, "rm -rf /workspace")).rejects.toThrow("prohibited");
    await expect(target.execute(SESSION, "pnpm build && reboot")).rejects.toThrow("prohibited");
    await expect(target.execute(SESSION, "sh -c 'pnpm build'")).rejects.toThrow("prohibited");
  });

  it("auto-fixes lint only through a fix-capable lint command", async () => {
    const target = await service();
    await expect(target.autoFixLint(SESSION)).resolves.toMatchObject({ stdout: "pnpm exec eslint . --fix" });
    await expect(target.autoFixLint(SESSION, "pnpm test")).rejects.toThrow("Lint auto-fix");
  });

  it("installs only bare missing imports, then retries the failed command", async () => {
    const baseSandbox = createMockSandboxProvider();
    await baseSandbox.createSession({ tenantId: "ten_1", runId: "run_1", cycleId: "cycle_1", templateId: "base", environment: {} });
    const execute = baseSandbox.execute.bind(baseSandbox);
    const commands: string[] = [];
    const sandbox = {
      ...baseSandbox,
      execute: async (sessionId: string, command: string, timeoutMs?: number) => {
        commands.push(command);
        if (commands.length === 1) return { exitCode: 1, stdout: "", stderr: "Cannot find module 'zod'\nCannot find module './local'" };
        return execute(sessionId, command, timeoutMs);
      },
    };

    const result = await new SandboxService(sandbox).healImports(SESSION, "pnpm build");
    expect(result.installedPackages).toEqual(["zod"]);
    expect(commands).toEqual(["pnpm build", "pnpm install zod", "pnpm build"]);
  });

  it("reports placeholder content with its source location", async () => {
    const target = await service();
    const files = [{ path: "/workspace/project/page.tsx", content: "// TODO: add form\nconst title = 'Ready';" }];
    expect(target.detectPlaceholders(files)).toEqual([
      { path: "/workspace/project/page.tsx", line: 1, kind: "todo", value: "TODO" },
    ]);
    expect(() => target.verifyNoPlaceholders(files)).toThrow("page.tsx:1");
  });
});
