import { createMockSandboxProvider, createMockSecretsProvider, type SecretsProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";
import { ProvisioningService } from "./provisioning.service";

const request = { tenantId: "ten_1", runId: "run_1", projectId: "prj_1", cycleId: "cycle_1", templateId: "base", environmentRefs: { API_KEY: "contract/secret" }, scaffold: [{ path: "package.json", content: "{}" }] } as const;

describe("ProvisioningService", () => {
  it("creates once per build cycle, grounds references, and scaffolds the project", async () => {
    const sandbox = createMockSandboxProvider();
    const service = new ProvisioningService(sandbox, createMockSecretsProvider());
    const first = await service.provision(request);
    const second = await service.provision(request);
    expect(first).toMatchObject({ sessionId: "ses_mock-1", projectDirectory: "/workspace/prj_1", reused: false });
    expect(second).toMatchObject({ sessionId: "ses_mock-1", reused: true });
    expect(Object.keys(sandbox.sessions.get("ses_mock-1")?.environment ?? {})).toEqual(["API_KEY"]);
    expect(sandbox.files.get("ses_mock-1")).toEqual([{ path: "/workspace/prj_1/package.json", content: "{}" }]);
    expect(Object.values(first)).not.toContain("contract-secret-value");
  });

  it("closes and forgets a completed build cycle", async () => {
    const sandbox = createMockSandboxProvider();
    const service = new ProvisioningService(sandbox, createMockSecretsProvider());
    await service.provision(request);
    await service.closeCycle(request.tenantId, request.runId, request.projectId, request.cycleId);
    expect(sandbox.sessions.size).toBe(0);
  });

  it("rejects unsafe scaffolding paths before creating a sandbox", async () => {
    const sandbox = createMockSandboxProvider();
    const service = new ProvisioningService(sandbox, createMockSecretsProvider());
    expect(() => service.provision({ ...request, scaffold: [{ path: "../secret", content: "x" }] })).toThrow(/relative/);
    expect(sandbox.sessions.size).toBe(0);
  });

  it("rejects a project identifier that could escape the workspace", () => {
    const sandbox = createMockSandboxProvider();
    const service = new ProvisioningService(sandbox, createMockSecretsProvider());
    expect(() => service.provision({ ...request, projectId: ".." })).toThrow(/projectId/);
    expect(sandbox.sessions.size).toBe(0);
  });

  it("allows retry after a transient secret lookup failure", async () => {
    const sandbox = createMockSandboxProvider();
    const baseSecrets = createMockSecretsProvider();
    const secrets: SecretsProvider = {
      ...baseSecrets,
      getSecret: vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue("contract-secret-value"),
    };
    const service = new ProvisioningService(sandbox, secrets);

    await expect(service.provision(request)).rejects.toThrow("unavailable");
    await expect(service.provision(request)).resolves.toMatchObject({ sessionId: "ses_mock-1", reused: false });
    expect(secrets.getSecret).toHaveBeenCalledTimes(2);
  });
});
