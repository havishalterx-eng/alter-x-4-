import { describe, expect, it, vi } from "vitest";
import { E2bSandboxProvider } from "./e2b-sandbox-provider";

describe("E2bSandboxProvider", () => {
  it("creates, writes, and closes a sandbox without exposing its API key", async () => {
    const write = vi.fn(async () => undefined);
    const read = vi.fn(async () => "{}");
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "ok", stderr: "" }));
    const kill = vi.fn(async () => undefined);
    const create = vi.fn(async () => ({ sandboxId: "e2b_ses_1", files: { write, read }, commands: { run }, kill }));
    const provider = new E2bSandboxProvider({ apiKey: "adapter-test-key", timeoutMs: 1_000 }, { create });
    const session = await provider.createSession({ tenantId: "ten_1", runId: "run_1", cycleId: "cycle_1", templateId: "base", environment: { API_KEY: "resolved-runtime-only" } });
    await provider.writeFiles(session.sessionId, [{ path: "/workspace/prj_1/package.json", content: "{}" }]);
    await expect(provider.readFile(session.sessionId, "/workspace/prj_1/package.json")).resolves.toBe("{}");
    await expect(provider.execute(session.sessionId, "pnpm install")).resolves.toMatchObject({ exitCode: 0 });
    await provider.closeSession(session.sessionId);
    expect(create).toHaveBeenCalledWith("base", expect.objectContaining({ timeoutMs: 1_000, envs: { API_KEY: "resolved-runtime-only" } }));
    expect(write).toHaveBeenCalledWith([{ path: "/workspace/prj_1/package.json", data: "{}" }]);
    expect(run).toHaveBeenCalledWith("pnpm install", undefined);
    expect(kill).toHaveBeenCalledOnce();
    expect(JSON.stringify(session)).not.toContain("adapter-test-key");
  });
});
