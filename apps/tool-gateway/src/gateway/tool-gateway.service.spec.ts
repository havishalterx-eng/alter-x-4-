import {
  createMockConfigProvider,
  createMockSecretsProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  ToolGatewayNotImplementedError,
  ToolGatewayPermissionError,
  ToolGatewayRateLimitError,
  ToolGatewayValidationError,
} from "@alterx/adapters";
import { ToolGatewayService } from "./tool-gateway.service";

const RAW_SECRET_VALUE = "raw-tool-api-key-value";
const TENANT_A = "ten_018f47a2-7b11-7b11-8a11-1234567890ab";
const TENANT_B = "ten_018f47a2-7b11-7b11-8a11-0000000000bb";
const INTEGRATION_A = "itg_018f47a2-7b11-7b11-8a11-1234567890ab";
const INTEGRATION_B = "itg_018f47a2-7b11-7b11-8a11-0000000000bb";
const SECRET_REF = `/alter/prod/tenant/${TENANT_A}/integration/${INTEGRATION_A}/access-token`;
const WRONG_TENANT_SECRET_REF = `/alter/prod/tenant/${TENANT_B}/integration/${INTEGRATION_A}/access-token`;
const WRONG_INTEGRATION_SECRET_REF = `/alter/prod/tenant/${TENANT_A}/integration/${INTEGRATION_B}/access-token`;

function invokeRequest(
  overrides: Partial<Parameters<ToolGatewayService["invokeTool"]>[0]> = {},
) {
  return {
    tenant_id: TENANT_A,
    run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
    node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
    tool_name: "search.web",
    input_json: JSON.stringify({ query: "hello" }),
    credential_ref: SECRET_REF,
    ...overrides,
  };
}

function resolveRequest(
  overrides: Partial<Parameters<ToolGatewayService["resolveCredential"]>[0]> = {},
) {
  return {
    tenant_id: TENANT_A,
    integration_id: INTEGRATION_A,
    credential_ref: SECRET_REF,
    ...overrides,
  };
}

function secretProvider() {
  return createMockSecretsProvider({
    secrets: { [SECRET_REF]: RAW_SECRET_VALUE },
  });
}

describe("ToolGatewayService", () => {
  it("rejects invalid JSON before permission or credential work", async () => {
    const resolveToolPermission = vi.fn();
    const service = new ToolGatewayService(
      createMockConfigProvider({ resolveToolPermission }),
      secretProvider(),
    );

    await expect(
      service.invokeTool(invokeRequest({ input_json: "{bad" })),
    ).rejects.toBeInstanceOf(ToolGatewayValidationError);
    expect(resolveToolPermission).not.toHaveBeenCalled();
  });

  it("rejects missing required request fields", async () => {
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      secretProvider(),
    );

    await expect(
      service.invokeTool(invokeRequest({ tool_name: "" })),
    ).rejects.toThrow(/tool_name/);
    await expect(
      service.resolveCredential(resolveRequest({ integration_id: "" })),
    ).rejects.toThrow(/integration_id/);
  });

  it("enforces permission-denied bindings", async () => {
    const service = new ToolGatewayService(
      createMockConfigProvider({
        toolPermission: {
          allowed: false,
          rateLimitPerMinute: 60,
          requiredScopes: ["tools:search"],
        },
      }),
      secretProvider(),
    );

    await expect(service.invokeTool(invokeRequest())).rejects.toBeInstanceOf(
      ToolGatewayPermissionError,
    );
  });

  it("enforces per-tenant per-tool rate limits", async () => {
    const service = new ToolGatewayService(
      createMockConfigProvider({
        toolPermission: {
          allowed: true,
          rateLimitPerMinute: 1,
          requiredScopes: [],
        },
      }),
      secretProvider(),
    );

    await expect(service.invokeTool(invokeRequest())).rejects.toBeInstanceOf(
      ToolGatewayNotImplementedError,
    );
    await expect(service.invokeTool(invokeRequest())).rejects.toBeInstanceOf(
      ToolGatewayRateLimitError,
    );
  });

  it("rejects malformed permission rate limits", async () => {
    const service = new ToolGatewayService(
      createMockConfigProvider({
        toolPermission: {
          allowed: true,
          rateLimitPerMinute: 0,
          requiredScopes: [],
        },
      }),
      secretProvider(),
    );

    await expect(service.invokeTool(invokeRequest())).rejects.toThrow(
      /rateLimitPerMinute/,
    );
  });

  it("accepts a canonical tenant integration secret path and mints an opaque token", async () => {
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      secretProvider(),
      {
        now: () => new Date("2026-07-24T00:00:00.000Z"),
        mintCredentialToken: () => "cred_test-token",
      },
    );

    const response = await service.resolveCredential(resolveRequest());
    const serialized = JSON.stringify(response);

    expect(response).toEqual({
      resolved_reference: "cred_test-token",
      expires_at: "2026-07-24T00:05:00.000Z",
    });
    expect(response.resolved_reference).not.toBe(SECRET_REF);
    expect(serialized).not.toContain(SECRET_REF);
    expect(serialized).not.toContain(RAW_SECRET_VALUE);
  });

  it("rejects canonical credential resolution when tenant segment is wrong", async () => {
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      {
        ...secretProvider(),
        getSecret,
      },
    );

    await expect(
      service.resolveCredential(
        resolveRequest({
          credential_ref: WRONG_TENANT_SECRET_REF,
        }),
      ),
    ).rejects.toThrow(/not owned/);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("rejects canonical credential resolution when integration segment is wrong", async () => {
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      {
        ...secretProvider(),
        getSecret,
      },
    );

    await expect(
      service.resolveCredential(
        resolveRequest({
          credential_ref: WRONG_INTEGRATION_SECRET_REF,
        }),
      ),
    ).rejects.toThrow(/not owned/);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("rejects system-shaped secret references for tenant tool credentials", async () => {
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      {
        ...secretProvider(),
        getSecret,
      },
    );

    await expect(
      service.resolveCredential(
        resolveRequest({
          credential_ref: "/alter/prod/tool-gateway/system/bootstrap-token",
        }),
      ),
    ).rejects.toThrow(/tenant integration secret reference/);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("rejects expired opaque credential tokens", async () => {
    let nowMs = Date.parse("2026-07-24T00:00:00.000Z");
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      secretProvider(),
      {
        credentialTokenTtlMs: 1_000,
        now: () => new Date(nowMs),
        mintCredentialToken: () => "cred_expiring-token",
      },
    );
    const resolved = await service.resolveCredential(resolveRequest());
    nowMs += 1_001;

    await expect(
      service.invokeTool(
        invokeRequest({ credential_ref: resolved.resolved_reference }),
      ),
    ).rejects.toThrow(/not recognized/);
  });

  it("rejects cross-tenant opaque credential token consumption", async () => {
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      secretProvider(),
      { mintCredentialToken: () => "cred_tenant-a-token" },
    );
    const resolved = await service.resolveCredential(resolveRequest());

    await expect(
      service.invokeTool(
        invokeRequest({
          tenant_id: TENANT_B,
          credential_ref: resolved.resolved_reference,
        }),
      ),
    ).rejects.toThrow(/not owned/);
  });

  it("accepts non-expired opaque credential tokens without resolving SecretsProvider again", async () => {
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      {
        ...secretProvider(),
        getSecret,
      },
      { mintCredentialToken: () => "cred_active-token" },
    );
    const resolved = await service.resolveCredential(resolveRequest());
    getSecret.mockClear();

    await expect(
      service.invokeTool(
        invokeRequest({ credential_ref: resolved.resolved_reference }),
      ),
    ).rejects.toBeInstanceOf(ToolGatewayNotImplementedError);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("bounds credential token storage by evicting expired records", async () => {
    let nowMs = Date.parse("2026-07-24T00:00:00.000Z");
    let tokenIndex = 0;
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      {
        ...secretProvider(),
        getSecret,
      },
      {
        credentialTokenTtlMs: 1_000,
        maxCredentialTokens: 1,
        now: () => new Date(nowMs),
        mintCredentialToken: () => `cred_sweep-${(tokenIndex += 1)}`,
      },
    );
    const expired = await service.resolveCredential(resolveRequest());
    nowMs += 1_001;
    await service.resolveCredential(resolveRequest());
    getSecret.mockClear();

    await expect(
      service.invokeTool(
        invokeRequest({ credential_ref: expired.resolved_reference }),
      ),
    ).rejects.toThrow(/not recognized/);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("fails loudly if opaque token minting cannot produce a unique value", async () => {
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      secretProvider(),
      { mintCredentialToken: () => "cred_duplicate" },
    );

    await service.resolveCredential(resolveRequest());
    await expect(service.resolveCredential(resolveRequest())).rejects.toThrow(
      /unique credential token/,
    );
  });

  it("accepts raw canonical SecretsProvider references through invokeTool but never dispatches before GATE-8", async () => {
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      {
        ...secretProvider(),
        getSecret,
      },
    );

    await expect(service.invokeTool(invokeRequest())).rejects.toSatisfy(
      (error: unknown) => {
        const serialized = JSON.stringify(error);
        return (
          error instanceof ToolGatewayNotImplementedError &&
          !serialized.includes(RAW_SECRET_VALUE)
        );
      },
    );
    expect(getSecret).toHaveBeenCalledWith(SECRET_REF);
  });

  it("keeps fetchUrl unimplemented until GATE-8", async () => {
    const service = new ToolGatewayService(
      createMockConfigProvider(),
      secretProvider(),
    );

    await expect(
      service.fetchUrl({
        tenant_id: "ten_018f47a2-7b11-7b11-8a11-1234567890ab",
        run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
        node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
        url: "https://example.com",
        network_policy_json: "{}",
      }),
    ).rejects.toBeInstanceOf(ToolGatewayNotImplementedError);
  });
});
