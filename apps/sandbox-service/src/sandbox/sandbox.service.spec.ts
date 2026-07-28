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
  });
});
