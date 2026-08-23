import {
  createMockAuditEventHandler,
  createMockConfigProvider,
  createMockQueueProvider,
  createMockSearchProvider,
  createMockSecretsProvider,
  type AuditEventHandler,
  type ConfigProvider,
  type QueueProvider,
  type SearchProvider,
  type SecretsProvider,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  SsrfGuardedFetcher,
  ToolGatewayNotImplementedError,
  ToolGatewayPermissionError,
  ToolGatewayRateLimitError,
  ToolGatewayValidationError,
  type DatabaseOperationProvider,
  type DnsResolver,
  type FetchFn,
} from "@alterx/adapters";
import {
  ToolGatewayService,
  type ToolGatewayServiceOptions,
} from "./tool-gateway.service";

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
    tool_name: "other.tool",
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

function noopDnsResolver(): DnsResolver {
  return async () => [{ address: "93.184.216.34", family: 4 }];
}

function noopFetchFn(): FetchFn {
  return async () => ({
    status: 200,
    headers: { get: () => null },
    body: undefined,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
}

function fakeDatabaseProvider(
  execute: DatabaseOperationProvider["execute"] = vi.fn(async () => ({
    rowCount: 1,
    rows: [{ answer: 42 }],
  })),
): DatabaseOperationProvider {
  return { providerId: "mock.database", execute };
}

interface ServiceOverrides {
  readonly configProvider?: ConfigProvider;
  readonly secretsProvider?: SecretsProvider;
  readonly searchProvider?: SearchProvider;
  readonly urlFetcher?: SsrfGuardedFetcher;
  readonly auditClient?: AuditEventHandler;
  readonly databaseProvider?: DatabaseOperationProvider;
  readonly costQueue?: QueueProvider;
  readonly costEventsQueueName?: string;
  readonly options?: ToolGatewayServiceOptions;
}

function buildService(overrides: ServiceOverrides = {}): ToolGatewayService {
  return new ToolGatewayService(
    overrides.configProvider ?? createMockConfigProvider(),
    overrides.secretsProvider ?? secretProvider(),
    overrides.searchProvider ?? createMockSearchProvider(),
    overrides.urlFetcher ??
      new SsrfGuardedFetcher({}, noopDnsResolver(), noopFetchFn()),
    overrides.auditClient ?? createMockAuditEventHandler(),
    overrides.databaseProvider ?? fakeDatabaseProvider(),
    overrides.costQueue ?? createMockQueueProvider(),
    overrides.costEventsQueueName ?? "test-cost-events",
    overrides.options ?? {},
  );
}

describe("ToolGatewayService", () => {
  it("rejects invalid JSON before permission or credential work", async () => {
    const resolveToolPermission = vi.fn();
    const service = buildService({
      configProvider: createMockConfigProvider({ resolveToolPermission }),
    });

    await expect(
      service.invokeTool(invokeRequest({ input_json: "{bad" })),
    ).rejects.toBeInstanceOf(ToolGatewayValidationError);
    expect(resolveToolPermission).not.toHaveBeenCalled();
  });

  it("rejects missing required request fields", async () => {
    const service = buildService();

    await expect(
      service.invokeTool(invokeRequest({ tool_name: "" })),
    ).rejects.toThrow(/tool_name/);
    await expect(
      service.resolveCredential(resolveRequest({ integration_id: "" })),
    ).rejects.toThrow(/integration_id/);
  });

  it("enforces permission-denied bindings and audits the denial", async () => {
    const auditClient = createMockAuditEventHandler();
    const service = buildService({
      configProvider: createMockConfigProvider({
        toolPermission: {
          allowed: false,
          rateLimitPerMinute: 60,
          requiredScopes: ["tools:search"],
        },
      }),
      auditClient,
    });

    await expect(service.invokeTool(invokeRequest())).rejects.toBeInstanceOf(
      ToolGatewayPermissionError,
    );
    expect(
      (auditClient as ReturnType<typeof createMockAuditEventHandler>).getRecordedEvents(),
    ).toContainEqual(expect.objectContaining({ result: "denied" }));
  });

  it("enforces per-tenant per-tool rate limits", async () => {
    const service = buildService({
      configProvider: createMockConfigProvider({
        toolPermission: {
          allowed: true,
          rateLimitPerMinute: 1,
          requiredScopes: [],
        },
      }),
    });

    await expect(service.invokeTool(invokeRequest())).rejects.toBeInstanceOf(
      ToolGatewayNotImplementedError,
    );
    await expect(service.invokeTool(invokeRequest())).rejects.toBeInstanceOf(
      ToolGatewayRateLimitError,
    );
  });

  it("rejects malformed permission rate limits", async () => {
    const service = buildService({
      configProvider: createMockConfigProvider({
        toolPermission: {
          allowed: true,
          rateLimitPerMinute: 0,
          requiredScopes: [],
        },
      }),
    });

    await expect(service.invokeTool(invokeRequest())).rejects.toThrow(
      /rateLimitPerMinute/,
    );
  });

  it("dispatches search.web to the real SearchProvider and returns its result", async () => {
    const search = vi.fn(async () => ({
      results: [
        { title: "t", url: "https://example.com", snippet: "s", score: 0.5 },
      ],
    }));
    const auditClient = createMockAuditEventHandler();
    const service = buildService({
      searchProvider: { ...createMockSearchProvider(), search },
      auditClient,
    });

    const response = await service.invokeTool(
      invokeRequest({
        tool_name: "search.web",
        input_json: JSON.stringify({ query: "hello world", maxResults: 3 }),
      }),
    );

    expect(search).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      query: "hello world",
      maxResults: 3,
    });
    expect(JSON.parse(response.output_json)).toEqual({
      results: [
        { title: "t", url: "https://example.com", snippet: "s", score: 0.5 },
      ],
    });
    expect(response.audit_id).toMatch(
      /^aud_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      (auditClient as ReturnType<typeof createMockAuditEventHandler>).getRecordedEvents(),
    ).toContainEqual(
      expect.objectContaining({ target_ref: "search.web", result: "success" }),
    );
  });

  it("rejects search.web input missing a query", async () => {
    const service = buildService();

    await expect(
      service.invokeTool(
        invokeRequest({ tool_name: "search.web", input_json: "{}" }),
      ),
    ).rejects.toThrow(/non-empty query/);
  });

  it.each([0, -1, -100])(
    "rejects search.web input with a non-positive maxResults (%i)",
    async (maxResults) => {
      const service = buildService();

      await expect(
        service.invokeTool(
          invokeRequest({
            tool_name: "search.web",
            input_json: JSON.stringify({ query: "x", maxResults }),
          }),
        ),
      ).rejects.toThrow(/positive integer/);
    },
  );

  it("audits an error result when the underlying search call throws", async () => {
    const auditClient = createMockAuditEventHandler();
    const service = buildService({
      searchProvider: {
        ...createMockSearchProvider(),
        search: async () => {
          throw new Error("upstream failure");
        },
      },
      auditClient,
    });

    await expect(
      service.invokeTool(
        invokeRequest({
          tool_name: "search.web",
          input_json: JSON.stringify({ query: "x" }),
        }),
      ),
    ).rejects.toThrow("upstream failure");
    expect(
      (auditClient as ReturnType<typeof createMockAuditEventHandler>).getRecordedEvents(),
    ).toContainEqual(expect.objectContaining({ result: "error" }));
  });

  describe("database.* dispatch (ENGINE-RESTRUCTURE-P4-1, moved from SandboxService)", () => {
    const DATABASE_ID = "db_accounts";
    const DATABASE_CREDENTIAL_REF = `/alter/prod/tenant/${TENANT_A}/integration/${DATABASE_ID}/password`;
    const WRONG_DATABASE_CREDENTIAL_REF = `/alter/prod/tenant/${TENANT_A}/integration/db_other/password`;

    function databaseSecretsProvider() {
      return createMockSecretsProvider({
        secrets: {
          [SECRET_REF]: RAW_SECRET_VALUE,
          [DATABASE_CREDENTIAL_REF]: "postgres://db-connection-string",
          [WRONG_DATABASE_CREDENTIAL_REF]: "postgres://db-connection-string",
          [WRONG_TENANT_SECRET_REF]: "postgres://db-connection-string",
        },
      });
    }

    function databaseInvokeRequest(
      overrides: Partial<Parameters<ToolGatewayService["invokeTool"]>[0]> = {},
    ) {
      return invokeRequest({
        tool_name: "database.select",
        input_json: JSON.stringify({
          databaseId: DATABASE_ID,
          statement: "SELECT 1",
          parameters: [],
        }),
        credential_ref: DATABASE_CREDENTIAL_REF,
        ...overrides,
      });
    }

    function serviceWithScope(
      requiredScopes: readonly string[],
      overrides: ServiceOverrides = {},
    ): ToolGatewayService {
      return buildService({
        secretsProvider: databaseSecretsProvider(),
        configProvider: createMockConfigProvider({
          toolPermission: { allowed: true, rateLimitPerMinute: 60, requiredScopes },
        }),
        ...overrides,
      });
    }

    it("dispatches a real database operation and audits success", async () => {
      const auditClient = createMockAuditEventHandler();
      const execute = vi.fn(async () => ({ rowCount: 1, rows: [{ answer: 42 }] }));
      const service = serviceWithScope([`database:${DATABASE_ID}`], {
        databaseProvider: fakeDatabaseProvider(execute),
        auditClient,
      });

      const response = await service.invokeTool(databaseInvokeRequest());

      expect(JSON.parse(response.output_json)).toEqual({
        rowCount: 1,
        rows: [{ answer: 42 }],
      });
      expect(execute).toHaveBeenCalledWith({
        credentialReference: DATABASE_CREDENTIAL_REF,
        databaseId: DATABASE_ID,
        operation: "select",
        statement: "SELECT 1",
        parameters: [],
      });
      expect(
        (auditClient as ReturnType<typeof createMockAuditEventHandler>).getRecordedEvents(),
      ).toContainEqual(
        expect.objectContaining({ target_ref: "database.select", result: "success" }),
      );
    });

    it("emits a real cost event scoped to tool_gateway on a successful dispatch", async () => {
      const publish = vi.fn<(queueName: string, message: unknown) => Promise<void>>(
        async () => undefined,
      );
      const service = serviceWithScope([`database:${DATABASE_ID}`], {
        costQueue: createMockQueueProvider({ publish }),
        costEventsQueueName: "test-cost-events",
      });

      await service.invokeTool(databaseInvokeRequest());

      expect(publish).toHaveBeenCalledTimes(1);
      const [queueName, event] = publish.mock.calls[0] as [string, Record<string, unknown>];
      expect(queueName).toBe("test-cost-events");
      expect(event).toMatchObject({ source: "tool_gateway" });
      expect(JSON.parse(event.usage_json as string)).toMatchObject({
        resource_type: "tool_gateway.database.select",
        outcome: "success",
      });
    });

    it("rejects a database.* tool_name naming an unsupported operation", async () => {
      const service = serviceWithScope([`database:${DATABASE_ID}`]);

      await expect(
        service.invokeTool(
          databaseInvokeRequest({ tool_name: "database.drop" }),
        ),
      ).rejects.toBeInstanceOf(ToolGatewayNotImplementedError);
    });

    it("rejects a credential_ref naming a different database (strict ownership)", async () => {
      const service = serviceWithScope([`database:${DATABASE_ID}`, "database:db_other"]);

      await expect(
        service.invokeTool(
          databaseInvokeRequest({ credential_ref: WRONG_DATABASE_CREDENTIAL_REF }),
        ),
      ).rejects.toThrow(/not owned by this tenant\/database/);
    });

    it("rejects a credential_ref owned by a different tenant", async () => {
      const otherTenantDatabaseRef = `/alter/prod/tenant/${TENANT_B}/integration/${DATABASE_ID}/password`;
      const service = serviceWithScope([`database:${DATABASE_ID}`], {
        secretsProvider: createMockSecretsProvider({
          secrets: {
            [SECRET_REF]: RAW_SECRET_VALUE,
            [otherTenantDatabaseRef]: "postgres://db-connection-string",
          },
        }),
      });

      await expect(
        service.invokeTool(
          databaseInvokeRequest({ credential_ref: otherTenantDatabaseRef }),
        ),
      ).rejects.toThrow(/not owned/);
    });

    it("denies a database scope the tenant's tool permission binding doesn't grant, and audits the denial", async () => {
      const auditClient = createMockAuditEventHandler();
      const service = serviceWithScope(["database:some_other_db"], { auditClient });

      await expect(
        service.invokeTool(databaseInvokeRequest()),
      ).rejects.toBeInstanceOf(ToolGatewayPermissionError);
      expect(
        (auditClient as ReturnType<typeof createMockAuditEventHandler>).getRecordedEvents(),
      ).toContainEqual(
        expect.objectContaining({ target_ref: "database.select", result: "denied" }),
      );
    });

    it("grants access via a database:* wildcard scope", async () => {
      const service = serviceWithScope(["database:*"]);

      await expect(
        service.invokeTool(databaseInvokeRequest()),
      ).resolves.toBeDefined();
    });
  });

  it("accepts a canonical tenant integration secret path and mints an opaque token", async () => {
    const service = buildService({
      options: {
        now: () => new Date("2026-07-24T00:00:00.000Z"),
        mintCredentialToken: () => "cred_test-token",
      },
    });

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
    const service = buildService({
      secretsProvider: { ...secretProvider(), getSecret },
    });

    await expect(
      service.resolveCredential(
        resolveRequest({ credential_ref: WRONG_TENANT_SECRET_REF }),
      ),
    ).rejects.toThrow(/not owned/);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("rejects canonical credential resolution when integration segment is wrong", async () => {
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = buildService({
      secretsProvider: { ...secretProvider(), getSecret },
    });

    await expect(
      service.resolveCredential(
        resolveRequest({ credential_ref: WRONG_INTEGRATION_SECRET_REF }),
      ),
    ).rejects.toThrow(/not owned/);
    expect(getSecret).not.toHaveBeenCalled();
  });

  it("rejects system-shaped secret references for tenant tool credentials", async () => {
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = buildService({
      secretsProvider: { ...secretProvider(), getSecret },
    });

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
    const service = buildService({
      options: {
        credentialTokenTtlMs: 1_000,
        now: () => new Date(nowMs),
        mintCredentialToken: () => "cred_expiring-token",
      },
    });
    const resolved = await service.resolveCredential(resolveRequest());
    nowMs += 1_001;

    await expect(
      service.invokeTool(
        invokeRequest({ credential_ref: resolved.resolved_reference }),
      ),
    ).rejects.toThrow(/not recognized/);
  });

  it("rejects cross-tenant opaque credential token consumption", async () => {
    const service = buildService({
      options: { mintCredentialToken: () => "cred_tenant-a-token" },
    });
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
    const service = buildService({
      secretsProvider: { ...secretProvider(), getSecret },
      options: { mintCredentialToken: () => "cred_active-token" },
    });
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
    const service = buildService({
      secretsProvider: { ...secretProvider(), getSecret },
      options: {
        credentialTokenTtlMs: 1_000,
        maxCredentialTokens: 1,
        now: () => new Date(nowMs),
        mintCredentialToken: () => `cred_sweep-${(tokenIndex += 1)}`,
      },
    });
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
    const service = buildService({
      options: { mintCredentialToken: () => "cred_duplicate" },
    });

    await service.resolveCredential(resolveRequest());
    await expect(service.resolveCredential(resolveRequest())).rejects.toThrow(
      /unique credential token/,
    );
  });

  it("accepts raw canonical SecretsProvider references through invokeTool but never dispatches an unimplemented tool", async () => {
    const getSecret = vi.fn(secretProvider().getSecret);
    const service = buildService({
      secretsProvider: { ...secretProvider(), getSecret },
    });

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

  it("fetches a public URL through the SSRF-guarded fetcher and stores an artifact", async () => {
    const auditClient = createMockAuditEventHandler();
    const urlFetcher = new SsrfGuardedFetcher(
      {},
      noopDnsResolver(),
      async () => ({
        status: 200,
        headers: { get: () => null },
        body: undefined,
        arrayBuffer: async () => new TextEncoder().encode("hello").buffer as ArrayBuffer,
      }),
    );
    const service = buildService({ urlFetcher, auditClient });

    const response = await service.fetchUrl({
      tenant_id: TENANT_A,
      run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
      node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
      url: "https://example.com",
      network_policy_json: "{}",
    });

    expect(response.status_code).toBe(200);
    expect(response.content_artifact_id).toMatch(/^art_/);
    expect(
      (auditClient as ReturnType<typeof createMockAuditEventHandler>).getRecordedEvents(),
    ).toContainEqual(
      expect.objectContaining({ action: "url.fetch", result: "success" }),
    );
  });

  it("rejects and audits an SSRF-blocked fetchUrl target as denied", async () => {
    const auditClient = createMockAuditEventHandler();
    const urlFetcher = new SsrfGuardedFetcher(
      {},
      async () => [{ address: "10.0.0.5", family: 4 }],
      noopFetchFn(),
    );
    const service = buildService({ urlFetcher, auditClient });

    await expect(
      service.fetchUrl({
        tenant_id: TENANT_A,
        run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
        node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
        url: "https://internal.example.com",
        network_policy_json: "{}",
      }),
    ).rejects.toThrow(/blocked private\/internal IP/);
    expect(
      (auditClient as ReturnType<typeof createMockAuditEventHandler>).getRecordedEvents(),
    ).toContainEqual(
      expect.objectContaining({ action: "url.fetch", result: "denied" }),
    );
  });

  it("rejects an invalid fetchUrl URL before touching the fetcher", async () => {
    const service = buildService();

    await expect(
      service.fetchUrl({
        tenant_id: TENANT_A,
        run_id: "run_018f47a2-7b11-7b11-8a11-1234567890ab",
        node_execution_id: "node_018f47a2-7b11-7b11-8a11-1234567890ab",
        url: "not-a-url",
        network_policy_json: "{}",
      }),
    ).rejects.toBeInstanceOf(ToolGatewayValidationError);
  });
});
