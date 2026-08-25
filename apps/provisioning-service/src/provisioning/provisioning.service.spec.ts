import { createMockSandboxProvider, createMockSecretsProvider, type SandboxProvider, type SecretsProvider } from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";
import { ProvisioningService } from "./provisioning.service";

const TENANT = "ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ab";
const SECRET_REFERENCE = `/alter/local/tenant/${TENANT}/integration/int_1/api-key`;
const request = {
  tenantId: TENANT,
  runId: "run_1",
  projectId: "prj_1",
  cycleId: "cycle_1",
  templateId: "base",
  environmentRefs: {
    API_KEY: SECRET_REFERENCE,
  },
  scaffold: [{ path: "package.json", content: "{}" }],
} as const;

function secrets() {
  return createMockSecretsProvider({
    secrets: { [SECRET_REFERENCE]: "contract-secret-value" },
  });
}

describe("ProvisioningService", () => {
  it("creates once per build cycle, grounds references, and scaffolds the project", async () => {
    const sandbox = createMockSandboxProvider();
    const service = new ProvisioningService(sandbox, secrets());
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
    const service = new ProvisioningService(sandbox, secrets());
    await service.provision(request);
    await service.closeCycle(request.tenantId, request.runId, request.projectId, request.cycleId);
    expect(sandbox.sessions.size).toBe(0);
  });

  it("closes an in-flight session when the cycle is cancelled before provisioning registers it", async () => {
    const sandbox = createMockSandboxProvider();
    let releaseWriteFiles!: () => void;
    const writeFilesGate = new Promise<void>((resolve) => {
      releaseWriteFiles = resolve;
    });
    const gated: SandboxProvider = {
      ...sandbox,
      writeFiles: async (sessionId, files) => {
        await writeFilesGate;
        return sandbox.writeFiles(sessionId, files);
      },
    };
    const service = new ProvisioningService(gated, secrets());

    const provisioning = service.provision(request);
    const closing = service.closeCycle(
      request.tenantId,
      request.runId,
      request.projectId,
      request.cycleId,
    );
    releaseWriteFiles();
    await closing;
    await provisioning;

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

  it("rejects environment secret references not owned by provisioning tenant", async () => {
    const sandbox = createMockSandboxProvider();
    const secrets = createMockSecretsProvider();
    const service = new ProvisioningService(sandbox, secrets);

    await expect(service.provision({
      ...request,
      environmentRefs: {
        API_KEY: "/alter/local/tenant/ten_018f4d6e-2b4a-7a3e-8c1a-1234567890ac/integration/int_1/api-key",
      },
    })).rejects.toThrow(/owned by provisioning tenant/);
    expect(sandbox.sessions.size).toBe(0);
  });

  it("rejects non-tenant environment secret references before resolution", async () => {
    const sandbox = createMockSandboxProvider();
    const secrets = createMockSecretsProvider();
    const service = new ProvisioningService(sandbox, secrets);

    await expect(service.provision({
      ...request,
      environmentRefs: { API_KEY: "/alter/local/provisioning-service/system/e2b-api-key" },
    })).rejects.toThrow(/owned by provisioning tenant/);
    expect(sandbox.sessions.size).toBe(0);
  });

  it("allows retry after a transient secret lookup failure", async () => {
    const sandbox = createMockSandboxProvider();
    const baseSecrets = secrets();
    const transientSecrets: SecretsProvider = {
      ...baseSecrets,
      getSecret: vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue("contract-secret-value"),
    };
    const service = new ProvisioningService(sandbox, transientSecrets);

    await expect(service.provision(request)).rejects.toThrow("unavailable");
    await expect(service.provision(request)).resolves.toMatchObject({ sessionId: "ses_mock-1", reused: false });
    expect(transientSecrets.getSecret).toHaveBeenCalledTimes(2);
  });
});
