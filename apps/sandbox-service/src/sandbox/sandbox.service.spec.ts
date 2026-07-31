import {
  MockBrowserAutomationProvider,
  SsrfGuardedFetcher,
  type DatabaseOperationProvider,
  type FetchFn,
  type ResolvedAddress,
} from "@alterx/adapters";
import {
  createMockConfigProvider,
  createMockBrowserProvider,
  createMockQueueProvider,
  createMockSandboxProvider,
  type JsonValue,
} from "@alterx/shared-clients";
import { describe, expect, it, vi } from "vitest";

import {
  SandboxService,
  type SandboxToolCallContext,
} from "./sandbox.service";

const SESSION = "ses_mock-1";
const UUID = "018f47a2-7b11-7b11-8a11-1234567890ab";
const OTHER_UUID = "018f47a2-7b11-7b11-8a11-0000000000bb";
const CONTEXT: SandboxToolCallContext = {
  tenantId: `ten_${UUID}`,
  runId: `run_${UUID}`,
  nodeExecutionId: `node_${UUID}`,
  requestId: `req_${UUID}`,
  traceId: `trc_${UUID}`,
};
const DATABASE_ID = "db_accounts";
const CREDENTIAL_REFERENCE = `/alter/test/tenant/${CONTEXT.tenantId}/integration/${DATABASE_ID}/password`;

async function basicService(): Promise<SandboxService> {
  const sandbox = createMockSandboxProvider();
  await sandbox.createSession({
    tenantId: CONTEXT.tenantId,
    runId: CONTEXT.runId,
    cycleId: "cycle_1",
    templateId: "base",
    environment: {},
  });
  return new SandboxService(sandbox);
}

function arrayBuffer(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

function toolHarness(options: {
  readonly publish?: (queueName: string, message: JsonValue) => Promise<void>;
  readonly database?: DatabaseOperationProvider;
} = {}) {
  const addresses: Record<string, readonly ResolvedAddress[]> = {
    "example.com": [{ address: "93.184.216.34", family: 4 }],
    "redirect.example.com": [{ address: "93.184.216.35", family: 4 }],
    "internal.example.com": [{ address: "10.0.0.9", family: 4 }],
  };
  const resolveDns = async (hostname: string) => addresses[hostname] ?? [];
  const fetchFn: FetchFn = vi.fn(async (url) => {
    if (url === "https://redirect.example.com/start") {
      return {
        status: 302,
        headers: {
          get: (name: string) =>
            name === "location" ? "https://internal.example.com/secret" : null,
        },
        body: undefined,
        arrayBuffer: async () => arrayBuffer(""),
      };
    }
    return {
      status: 200,
      headers: { get: () => null },
      body: undefined,
      arrayBuffer: async () => arrayBuffer("public response"),
    };
  });
  const urlFetcher = new SsrfGuardedFetcher(
    { maxResponseBytes: 1_048_576 },
    resolveDns,
    fetchFn,
  );
  const sandbox = createMockSandboxProvider();
  const messages: { queueName: string; message: JsonValue }[] = [];
  const inMemoryQueue = createMockQueueProvider();
  const publish =
    options.publish ??
    (async (queueName: string, message: JsonValue) => {
      messages.push({ queueName, message });
      await inMemoryQueue.publish(queueName, message);
    });
  const database =
    options.database ??
    ({
      providerId: "mock.database",
      execute: vi.fn(async () => ({
        rowCount: 1,
        rows: [{ answer: 42 }],
      })),
    } satisfies DatabaseOperationProvider);
  const costQueue = createMockQueueProvider({
    publish,
    consume: (queueName) => inMemoryQueue.consume(queueName),
  });
  const service = new SandboxService(sandbox, {
    browser: new MockBrowserAutomationProvider(urlFetcher),
    config: createMockConfigProvider({
      toolPermission: {
        allowed: true,
        rateLimitPerMinute: 60,
        requiredScopes: [`database:${DATABASE_ID}`],
      },
    }),
    database,
    urlFetcher,
    costQueue,
    costEventsQueueName: "alter-test-cost-events",
    mintCostEventId: () => `cst_${UUID}`,
  });
  return { costQueue, database, fetchFn, messages, sandbox, service };
}

async function provision(harness: ReturnType<typeof toolHarness>): Promise<void> {
  await harness.sandbox.createSession({
    tenantId: CONTEXT.tenantId,
    runId: CONTEXT.runId,
    cycleId: "cycle_1",
    templateId: "base",
    environment: {},
  });
}

function databaseRequest() {
  return {
    credentialReference: CREDENTIAL_REFERENCE,
    databaseId: DATABASE_ID,
    operation: "select" as const,
    statement: "SELECT answer FROM values WHERE id = $1",
    parameters: [1] as const,
  };
}

describe("SandboxService existing EXEC-10 tools", () => {
  it("executes commands and manages files only within workspace", async () => {
    const target = await basicService();
    await target.writeFiles(SESSION, [
      { path: "/workspace/project/package.json", content: "{}" },
    ]);
    await expect(
      target.readFile(SESSION, "/workspace/project/package.json"),
    ).resolves.toBe("{}");
    await expect(target.execute(SESSION, "pnpm install")).resolves.toMatchObject({
      exitCode: 0,
    });
  });

  it("installs packages only through supported package managers", async () => {
    const target = await basicService();
    await expect(
      target.installPackage(SESSION, "pnpm", "zod"),
    ).resolves.toMatchObject({ exitCode: 0 });
    await expect(target.installPackage(SESSION, "apt", "curl")).rejects.toThrow(
      "Package manager",
    );
  });

  it("rejects workspace escapes and destructive commands", async () => {
    const target = await basicService();
    await expect(
      target.readFile(SESSION, "/workspace/../secret"),
    ).rejects.toThrow("workspace");
    await expect(target.execute(SESSION, "rm -rf /workspace")).rejects.toThrow(
      "prohibited",
    );
  });
});

describe("SandboxService EXEC-13 tools", () => {
  it("drives scoped browser navigate/click/extract primitives", async () => {
    const target = toolHarness();
    await provision(target);
    const browser = await target.service.createBrowserSession(CONTEXT, SESSION);

    await expect(
      target.service.navigateBrowser(
        CONTEXT,
        SESSION,
        browser.sessionId,
        "https://example.com/page",
      ),
    ).resolves.toEqual({
      url: "https://example.com/page",
      title: "Local mock page",
    });
    await expect(
      target.service.clickBrowser(CONTEXT, SESSION, browser.sessionId, "#go"),
    ).resolves.toBeUndefined();
    await expect(
      target.service.extractBrowser(CONTEXT, SESSION, browser.sessionId, "main"),
    ).resolves.toEqual({
      text: "mock:main",
      url: "https://example.com/page",
    });
  });

  it("reuses seeded SSRF defenses for private, metadata, and redirect targets", async () => {
    const target = toolHarness();

    await expect(
      target.service.fetchUrl(CONTEXT, "https://internal.example.com/"),
    ).rejects.toThrow("blocked private/internal IP");
    await expect(
      target.service.fetchUrl(
        CONTEXT,
        "https://169.254.169.254/latest/meta-data/",
      ),
    ).rejects.toThrow("blocked private/internal IPv4");
    await expect(
      target.service.fetchUrl(CONTEXT, "https://redirect.example.com/start"),
    ).rejects.toThrow("blocked private/internal IP");
    expect(target.fetchFn).toHaveBeenCalledTimes(1);
    expect(target.messages).toHaveLength(3);
    for (const { message } of target.messages) {
      expect(
        JSON.parse(
          (message as Record<string, string>).usage_json ?? "{}",
        ),
      ).toMatchObject({
        resource_type: "sandbox.url.fetch",
        outcome: "error",
      });
    }
  });

  it("fetches public URL and returns bounded content", async () => {
    const target = toolHarness();
    await expect(
      target.service.fetchUrl(CONTEXT, "https://example.com/"),
    ).resolves.toEqual({
      statusCode: 200,
      body: "public response",
      finalUrl: "https://example.com/",
    });
  });

  it("enforces tenant-owned DB credential and AppConfig-derived DB scope", async () => {
    const target = toolHarness();
    await expect(
      target.service.executeDatabaseOperation(CONTEXT, databaseRequest()),
    ).resolves.toEqual({ rowCount: 1, rows: [{ answer: 42 }] });

    await expect(
      target.service.executeDatabaseOperation(CONTEXT, {
        ...databaseRequest(),
        credentialReference: `/alter/test/tenant/ten_${OTHER_UUID}/integration/${DATABASE_ID}/password`,
      }),
    ).rejects.toThrow("not owned");
    await expect(
      target.service.executeDatabaseOperation(CONTEXT, {
        ...databaseRequest(),
        operation: "drop" as "select",
        statement: "DROP TABLE values WHERE id = $1",
      }),
    ).rejects.toThrow("not supported");

    const denied = toolHarness();
    const deniedService = new SandboxService(denied.sandbox, {
      browser: new MockBrowserAutomationProvider(
        new SsrfGuardedFetcher({}, async () => [
          { address: "93.184.216.34", family: 4 },
        ]),
      ),
      config: createMockConfigProvider({
        toolPermission: {
          allowed: true,
          rateLimitPerMinute: 60,
          requiredScopes: ["database:other"],
        },
      }),
      database: denied.database,
      urlFetcher: new SsrfGuardedFetcher({}, async () => [
        { address: "93.184.216.34", family: 4 },
      ]),
      costQueue: createMockQueueProvider(),
      costEventsQueueName: "alter-test-cost-events",
    });
    await expect(
      deniedService.executeDatabaseOperation(CONTEXT, databaseRequest()),
    ).rejects.toThrow("not permitted");
  });

  it("evaluates calculator expressions deterministically without external calls", async () => {
    const target = toolHarness();
    await expect(target.service.calculate(CONTEXT, "2 + 3 * (4 ^ 2)")).resolves.toBe(
      50,
    );
    await expect(target.service.calculate(CONTEXT, "-2 ^ 2")).resolves.toBe(-4);
    await expect(target.service.calculate(CONTEXT, "2 ^ -2")).resolves.toBe(0.25);
    await expect(target.service.calculate(CONTEXT, "1 / 0")).rejects.toThrow(
      "division by zero",
    );
    await expect(
      target.service.calculate(CONTEXT, "process.exit()"),
    ).rejects.toThrow("invalid token");
  });

  it("emits exact cost schema with tenant/run/node/request/trace attribution", async () => {
    const target = toolHarness();
    await target.service.calculate(CONTEXT, "6 * 7");

    expect(target.messages).toHaveLength(1);
    const entry = target.messages[0];
    expect(entry?.queueName).toBe("alter-test-cost-events");
    const event = entry?.message as Record<string, string>;
    expect(Object.keys(event).sort()).toEqual([
      "amount_json",
      "cost_event_id",
      "node_execution_id",
      "occurred_at",
      "provider_reference",
      "run_id",
      "source",
      "tenant_id",
      "usage_json",
    ]);
    expect(event).toMatchObject({
      tenant_id: CONTEXT.tenantId,
      cost_event_id: `cst_${UUID}`,
      run_id: CONTEXT.runId,
      node_execution_id: CONTEXT.nodeExecutionId,
      provider_reference: "sandbox-calculator",
      source: "sandbox",
    });
    expect(new Date(event.occurred_at ?? "").toString()).not.toBe("Invalid Date");
    expect(JSON.parse(event.usage_json ?? "{}")).toEqual({
      resource_type: "sandbox.calculator.compute",
      provider: "sandbox-calculator",
      units: 1,
      outcome: "success",
      request_id: CONTEXT.requestId,
      trace_id: CONTEXT.traceId,
    });
    expect(JSON.parse(event.amount_json ?? "{}")).toEqual({
      usd: 0,
      estimated: true,
    });
    await expect(
      target.costQueue.consume("alter-test-cost-events"),
    ).resolves.toEqual(entry?.message);
  });

  it("fails open only when non-critical cost telemetry queue is unavailable", async () => {
    const target = toolHarness({
      publish: async () => {
        throw new Error("queue unavailable");
      },
    });
    await expect(target.service.calculate(CONTEXT, "40 + 2")).resolves.toBe(42);
  });

  it("rejects bare UUID tenant IDs consistently across all four tool families", async () => {
    const target = toolHarness();
    await provision(target);
    const bare = { ...CONTEXT, tenantId: UUID };

    await expect(target.service.createBrowserSession(bare, SESSION)).rejects.toThrow(
      "ten_ prefixed UUIDv7",
    );
    await expect(
      target.service.fetchUrl(bare, "https://example.com"),
    ).rejects.toThrow("ten_ prefixed UUIDv7");
    await expect(
      target.service.executeDatabaseOperation(bare, databaseRequest()),
    ).rejects.toThrow("ten_ prefixed UUIDv7");
    await expect(target.service.calculate(bare, "1 + 1")).rejects.toThrow(
      "ten_ prefixed UUIDv7",
    );
  });

  it("rejects empty or malformed request and trace IDs before tool dispatch", async () => {
    const target = toolHarness();
    await expect(
      target.service.calculate({ ...CONTEXT, requestId: "" }, "1 + 1"),
    ).rejects.toThrow("req_ prefixed UUIDv7");
    await expect(
      target.service.calculate({ ...CONTEXT, traceId: "trace-1" }, "1 + 1"),
    ).rejects.toThrow("trc_ prefixed UUIDv7");
    expect(target.messages).toHaveLength(0);
  });
});

describe("SandboxService EXEC-11 hardening", () => {
  it("rejects chained, shell-wrapped, and destructive commands", async () => {
    const target = await basicService();
    await expect(target.readFile(SESSION, "/workspace/../secret")).rejects.toThrow("workspace");
    await expect(target.execute(SESSION, "rm -rf /workspace")).rejects.toThrow("prohibited");
    await expect(target.execute(SESSION, "pnpm build && reboot")).rejects.toThrow("prohibited");
    await expect(target.execute(SESSION, "sh -c 'pnpm build'")).rejects.toThrow("prohibited");
  });

  it("auto-fixes lint only through a fix-capable lint command", async () => {
    const target = await basicService();
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
    const target = await basicService();
    const files = [{ path: "/workspace/project/page.tsx", content: "// TODO: add form\nconst title = 'Ready';" }];
    expect(target.detectPlaceholders(files)).toEqual([
      { path: "/workspace/project/page.tsx", line: 1, kind: "todo", value: "TODO" },
    ]);
    expect(() => target.verifyNoPlaceholders(files)).toThrow("page.tsx:1");
  });
});

describe("SandboxService EXEC-12 verification", () => {
  it("classifies syntax failures and timeouts", async () => {
    const sandbox = createMockSandboxProvider();
    await sandbox.createSession({ tenantId: "ten_1", runId: "run_1", cycleId: "cycle_1", templateId: "base", environment: {} });
    const target = new SandboxService({ ...sandbox, execute: async (_id: string, command: string) => command === "pnpm build" ? { exitCode: 1, stdout: "", stderr: "syntax error" } : { exitCode: 124, stdout: "", stderr: "timeout" } });
    await expect(target.verifyBuild(SESSION)).resolves.toMatchObject({ output: { verification: { status: "logic_failure" } } });
    await expect(target.verifyBuild(SESSION, "pnpm build --slow")).resolves.toMatchObject({ output: { verification: { status: "infra_failure" } } });
  });

  it("fails closed without a browser and flags blank rendered pages", async () => {
    const target = await basicService();
    await expect(target.verifyRender("https://preview.example", [])).resolves.toMatchObject({ output: { verification: { status: "inconclusive" } } });
    const browser = createMockBrowserProvider({ url: "https://preview.example", statusCode: 200, hasVisibleContent: false, consoleErrors: [] });
    const rendered = new SandboxService(createMockSandboxProvider(), undefined, browser);
    await expect(rendered.verifyRender("https://preview.example", [])).resolves.toMatchObject({ output: { verification: { status: "logic_failure" } } });
  });
});
