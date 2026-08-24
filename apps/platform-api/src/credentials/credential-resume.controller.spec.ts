import { describe, expect, it, vi } from "vitest";
import type { ActorContextType } from "../rbac";
import type { EngineClient } from "../engine/engine-client";
import { CredentialResumeController } from "./credential-resume.controller";
import { CredentialHttpError } from "./problem";
import type { CredentialService } from "./credential.service";
import type { CredentialView } from "./types";

const tenantId = "018f47a5-7b2c-7d10-8f11-123456789abc";
const runId = "run_018f47a5-7b2c-7d10-8f11-123456789abd";
const nodeExecutionId = "node_018f47a5-7b2c-7d10-8f11-123456789abe";

const actor: ActorContextType = {
  user_id: "018f47a5-7b2c-7d10-8f11-123456789abf",
  tenant_id: tenantId,
  workspace_id: "018f47a5-7b2c-7d10-8f11-123456789ac0",
  session_id: "sess_1",
  auth_time: 1_700_000_000,
  roles: ["admin"],
  permissions: [],
};

function credentialView(overrides: Partial<CredentialView> = {}): CredentialView {
  return {
    id: "018f47a5-7b2c-7d10-8f11-123456789ac1",
    name: `resume-${nodeExecutionId}`,
    connector: "postgres",
    scope: "project:deploy",
    last4: "****1234",
    created_at: "2026-08-01T00:00:00.000Z",
    version: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * F2/LOW (Phase 5): this controller previously had no coverage at all.
 * Real bugs found and fixed here: an auto-generated credential name with
 * no lookup-before-create, so a retry after a failed signal accumulated a
 * fresh orphaned credential every time; a hardcoded empty traceparent
 * instead of forwarding the real inbound header; and console.error in
 * place of the repo's established Logger convention.
 */
describe("CredentialResumeController", () => {
  function build(overrides: {
    readonly existing?: CredentialView;
    readonly signalError?: Error;
  } = {}): {
    controller: CredentialResumeController;
    credentials: CredentialService;
    engineClient: EngineClient;
  } {
    const created = credentialView();
    const credentials = {
      list: vi.fn(async () => (overrides.existing ? [overrides.existing] : [])),
      create: vi.fn(async () => created),
    } as unknown as CredentialService;
    const engineClient = {
      post: overrides.signalError
        ? vi.fn(async () => {
            throw overrides.signalError;
          })
        : vi.fn(async () => ({})),
    } as unknown as EngineClient;
    return {
      controller: new CredentialResumeController(credentials, engineClient),
      credentials,
      engineClient,
    };
  }

  it("creates a new credential when none exists for this node yet", async () => {
    const { controller, credentials } = build();
    const result = await controller.resume(
      runId,
      nodeExecutionId,
      { connector: "postgres", scope: "project:deploy", value: "s3cr3t" },
      actor,
      "00-trace-01",
    );
    expect(credentials.create).toHaveBeenCalledOnce();
    expect(result.name).toBe(`resume-${nodeExecutionId}`);
  });

  it("reuses the existing resume credential instead of creating a duplicate", async () => {
    const existing = credentialView({ id: "018f47a5-7b2c-7d10-8f11-123456789ac2" });
    const { controller, credentials } = build({ existing });
    const result = await controller.resume(
      runId,
      nodeExecutionId,
      { connector: "postgres", scope: "project:deploy", value: "s3cr3t" },
      actor,
      "00-trace-01",
    );
    expect(credentials.create).not.toHaveBeenCalled();
    expect(result.id).toBe(existing.id);
  });

  it("forwards the real inbound traceparent header to the engine signal, not a hardcoded empty one", async () => {
    const { controller, engineClient } = build();
    await controller.resume(
      runId,
      nodeExecutionId,
      { connector: "postgres", scope: "project:deploy", value: "s3cr3t" },
      actor,
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
    expect(engineClient.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      }),
      expect.anything(),
    );
  });

  it("forwards an empty traceparent only when the inbound header is genuinely absent", async () => {
    const { controller, engineClient } = build();
    await controller.resume(
      runId,
      nodeExecutionId,
      { connector: "postgres", scope: "project:deploy", value: "s3cr3t" },
      actor,
      undefined,
    );
    expect(engineClient.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ traceparent: "" }),
      expect.anything(),
    );
  });

  it("surfaces a 502 on signal failure, and the credential was still created", async () => {
    const { controller, credentials } = build({ signalError: new Error("temporal unreachable") });
    await expect(
      controller.resume(
        runId,
        nodeExecutionId,
        { connector: "postgres", scope: "project:deploy", value: "s3cr3t" },
        actor,
        "00-trace-01",
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(CredentialHttpError);
      expect((error as CredentialHttpError).getStatus()).toBe(502);
      return true;
    });
    expect(credentials.create).toHaveBeenCalledOnce();
  });

  it("a retry after a signal failure reuses the same credential rather than creating another", async () => {
    const existing = credentialView();
    const { controller: failing } = build({ existing, signalError: new Error("boom") });
    await expect(
      failing.resume(
        runId,
        nodeExecutionId,
        { connector: "postgres", scope: "project:deploy", value: "s3cr3t" },
        actor,
        "00-trace-01",
      ),
    ).rejects.toBeInstanceOf(CredentialHttpError);

    const { controller: retried, credentials } = build({ existing });
    const result = await retried.resume(
      runId,
      nodeExecutionId,
      { connector: "postgres", scope: "project:deploy", value: "s3cr3t" },
      actor,
      "00-trace-01",
    );
    expect(credentials.create).not.toHaveBeenCalled();
    expect(result.id).toBe(existing.id);
  });
});
