import { afterEach, describe, expect, it, vi } from "vitest";

describe("AUDIT_PROTO_PATH", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("resolves to the workspace-relative proto file when it exists", async () => {
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      existsSync: () => true,
    }));
    vi.resetModules();
    const { AUDIT_PROTO_PATH } = await import("./grpc.constants.js");
    expect(AUDIT_PROTO_PATH).toContain("packages/contracts/proto/alter/audit/v1/audit.proto");
  });

  it("falls back to the built-relative proto file when the workspace path does not exist", async () => {
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      existsSync: () => false,
    }));
    vi.resetModules();
    const { AUDIT_PROTO_PATH } = await import("./grpc.constants.js");
    expect(AUDIT_PROTO_PATH).toContain("proto/audit.proto");
    expect(AUDIT_PROTO_PATH).not.toContain("packages/contracts/proto/alter/audit/v1/audit.proto");
  });
});
