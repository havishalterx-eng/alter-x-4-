import type {
  BrowserAutomationProvider,
  BrowserExtractionResult,
  BrowserNavigationResult,
  BrowserSession,
  BrowserSessionScope,
  DatabaseOperationProvider,
  DatabaseOperationRequest,
  DatabaseOperationResult,
  SsrfGuardedFetcher,
} from "@alterx/adapters";
import type {
  ConfigProvider,
  JsonValue,
  QueueProvider,
  SandboxCommandResult,
  SandboxFile,
  SandboxProvider,
} from "@alterx/shared-clients";

import { calculate as evaluateExpression } from "./calculator";
import { createCostEventId } from "./cost-event-id";

const WORKSPACE = "/workspace";
const MAX_TOOL_OUTPUT_BYTES = 1_048_576;
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "pip"]);
const DATABASE_OPERATIONS = new Set(["select", "insert", "update", "delete"]);
const FORBIDDEN_COMMANDS = [
  /\b(?:rm|rmdir|del|erase|format|mkfs|fdisk|parted|dd|shutdown|reboot|poweroff|halt|kill|pkill|killall|sudo|su)\b/i,
  /(?:^|\s)(?:bash|sh|zsh|fish|powershell|pwsh|cmd)(?:\s+(?:-[A-Za-z]*c|\/c))\b/i,
  /\b(?:curl|wget)\b[^|]*\|/i,
  /(?:[;&|]|`|\$\(|\$\{|\r?\n)/,
];
const LINT_FIX_COMMAND = /\b(?:eslint|biome|prettier|ruff|lint)\b.*(?:--fix|--write)/i;
const NODE_BUILT_INS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "domain", "events", "fs", "http", "http2", "https", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);
const MISSING_IMPORT_PATTERNS = [
  /Cannot find module ['\"]([^'\"]+)['\"]/gi,
  /Failed to resolve import ['\"]([^'\"]+)['\"]/gi,
  /No module named ['\"]([^'\"]+)['\"]/gi,
];
const PLACEHOLDER_PATTERNS = [
  { kind: "todo", pattern: /\b(?:TODO|FIXME|XXX)\b/i },
  { kind: "implementation stub", pattern: /\b(?:IMPLEMENT ME|NOT IMPLEMENTED|REPLACE ME|YOUR[_ -]?CODE[_ -]?HERE)\b/i },
  { kind: "placeholder value", pattern: /<(?:YOUR_|INSERT_|REPLACE_|[A-Z][A-Z0-9_ -]{2,})[^>]*>/ },
  { kind: "placeholder text", pattern: /\b(?:lorem ipsum|coming soon)\b/i },
];

export interface PlaceholderFinding {
  readonly path: string;
  readonly line: number;
  readonly kind: string;
  readonly value: string;
}

export interface ImportHealResult {
  readonly initial: SandboxCommandResult;
  readonly result: SandboxCommandResult;
  readonly installedPackages: readonly string[];
}

const UUID_V7_BODY =
  "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export interface SandboxToolCallContext {
  readonly tenantId: string;
  readonly runId: string;
  readonly nodeExecutionId: string;
  readonly requestId: string;
  readonly traceId: string;
}

export interface SandboxUrlFetchResult {
  readonly statusCode: number;
  readonly body: string;
  readonly finalUrl: string;
}

export interface SandboxToolDependencies {
  readonly browser: BrowserAutomationProvider;
  readonly config: ConfigProvider;
  readonly database: DatabaseOperationProvider;
  readonly urlFetcher: SsrfGuardedFetcher;
  readonly costQueue: QueueProvider;
  readonly costEventsQueueName: string;
  readonly mintCostEventId?: () => string;
}

interface CostUsage {
  readonly provider: string;
  readonly resourceType: string;
  readonly units: number;
}

export class SandboxService {
  readonly #mintCostEventId: () => string;

  constructor(
    private readonly sandbox: SandboxProvider,
    private readonly tools?: SandboxToolDependencies,
  ) {
    this.#mintCostEventId = tools?.mintCostEventId ?? createCostEventId;
  }

  async writeFiles(
    sessionId: string,
    files: readonly SandboxFile[],
  ): Promise<void> {
    this.#requireSession(sessionId);
    for (const file of files) this.#requireWorkspacePath(file.path);
    await this.sandbox.writeFiles(sessionId, files);
  }

  async readFile(sessionId: string, path: string): Promise<string> {
    this.#requireSession(sessionId);
    this.#requireWorkspacePath(path);
    return this.sandbox.readFile(sessionId, path);
  }

  async execute(
    sessionId: string,
    command: string,
    timeoutMs?: number,
  ): Promise<SandboxCommandResult> {
    this.#requireSession(sessionId);
    if (
      command.trim().length === 0 ||
      FORBIDDEN_COMMANDS.some((pattern) => pattern.test(command))
    ) {
      throw new Error("Sandbox command is empty or prohibited");
    }
    return this.sandbox.execute(sessionId, command, timeoutMs);
  }

  async healImports(
    sessionId: string,
    command: string,
    manager = "pnpm",
    timeoutMs?: number,
  ): Promise<ImportHealResult> {
    const initial = await this.execute(sessionId, command, timeoutMs);
    if (initial.exitCode === 0) return { initial, result: initial, installedPackages: [] };

    const installedPackages = [...this.#missingPackages(initial.stderr)];
    for (const packageName of installedPackages) await this.installPackage(sessionId, manager, packageName);

    return {
      initial,
      result: installedPackages.length > 0 ? await this.execute(sessionId, command, timeoutMs) : initial,
      installedPackages,
    };
  }

  async autoFixLint(
    sessionId: string,
    command = "pnpm exec eslint . --fix",
    timeoutMs?: number,
  ): Promise<SandboxCommandResult> {
    if (!LINT_FIX_COMMAND.test(command)) throw new Error("Lint auto-fix command is invalid");
    return this.execute(sessionId, command, timeoutMs);
  }

  detectPlaceholders(files: readonly SandboxFile[]): readonly PlaceholderFinding[] {
    return files.flatMap((file) =>
      file.content.split(/\r?\n/).flatMap((line, index) =>
        PLACEHOLDER_PATTERNS.flatMap(({ kind, pattern }) => {
          const match = pattern.exec(line);
          pattern.lastIndex = 0;
          return match ? [{ path: file.path, line: index + 1, kind, value: match[0] }] : [];
        }),
      ),
    );
  }

  verifyNoPlaceholders(files: readonly SandboxFile[]): void {
    const findings = this.detectPlaceholders(files);
    if (findings.length === 0) return;
    const locations = findings.map(({ path, line }) => `${path}:${line}`).join(", ");
    throw new Error(`Placeholder content detected: ${locations}`);
  }

  async installPackage(
    sessionId: string,
    manager: string,
    packageName: string,
  ): Promise<SandboxCommandResult> {
    this.#requireSession(sessionId);
    if (
      !PACKAGE_MANAGERS.has(manager) ||
      !/^[A-Za-z0-9@._/-]+$/.test(packageName) ||
      packageName.split("/").includes("..")
    ) {
      throw new Error("Package manager or package name is invalid");
    }
    const command =
      manager === "pip"
        ? `pip install ${packageName}`
        : `${manager} install ${packageName}`;
    return this.sandbox.execute(sessionId, command);
  }

  async createBrowserSession(
    context: SandboxToolCallContext,
    sandboxSessionId: string,
  ): Promise<BrowserSession> {
    this.#validateToolContext(context);
    this.#requireSession(sandboxSessionId);
    const tools = this.#requireTools();
    return this.#costed(
      context,
      {
        provider: tools.browser.metadata.providerId,
        resourceType: "sandbox.browser.session",
        units: 1,
      },
      () => tools.browser.createSession(this.#browserScope(context, sandboxSessionId)),
    );
  }

  async navigateBrowser(
    context: SandboxToolCallContext,
    sandboxSessionId: string,
    browserSessionId: string,
    url: string,
  ): Promise<BrowserNavigationResult> {
    this.#validateToolContext(context);
    this.#requireSession(sandboxSessionId);
    const tools = this.#requireTools();
    return this.#costed(
      context,
      {
        provider: tools.browser.metadata.providerId,
        resourceType: "sandbox.browser.navigate",
        units: 1,
      },
      () =>
        tools.browser.navigate(
          this.#browserScope(context, sandboxSessionId),
          browserSessionId,
          url,
        ),
    );
  }

  async clickBrowser(
    context: SandboxToolCallContext,
    sandboxSessionId: string,
    browserSessionId: string,
    selector: string,
  ): Promise<void> {
    this.#validateToolContext(context);
    this.#requireSession(sandboxSessionId);
    const tools = this.#requireTools();
    await this.#costed(
      context,
      {
        provider: tools.browser.metadata.providerId,
        resourceType: "sandbox.browser.click",
        units: 1,
      },
      () =>
        tools.browser.click(
          this.#browserScope(context, sandboxSessionId),
          browserSessionId,
          selector,
        ),
    );
  }

  async extractBrowser(
    context: SandboxToolCallContext,
    sandboxSessionId: string,
    browserSessionId: string,
    selector?: string,
  ): Promise<BrowserExtractionResult> {
    this.#validateToolContext(context);
    this.#requireSession(sandboxSessionId);
    const tools = this.#requireTools();
    return this.#costed(
      context,
      {
        provider: tools.browser.metadata.providerId,
        resourceType: "sandbox.browser.extract",
        units: 1,
      },
      async () => {
        const result = await tools.browser.extract(
          this.#browserScope(context, sandboxSessionId),
          browserSessionId,
          selector,
        );
        this.#requireBoundedOutput(result.text);
        return result;
      },
    );
  }

  async closeBrowserSession(
    context: SandboxToolCallContext,
    sandboxSessionId: string,
    browserSessionId: string,
  ): Promise<void> {
    this.#validateToolContext(context);
    this.#requireSession(sandboxSessionId);
    const tools = this.#requireTools();
    await this.#costed(
      context,
      {
        provider: tools.browser.metadata.providerId,
        resourceType: "sandbox.browser.close",
        units: 1,
      },
      () =>
        tools.browser.closeSession(
          this.#browserScope(context, sandboxSessionId),
          browserSessionId,
        ),
    );
  }

  async fetchUrl(
    context: SandboxToolCallContext,
    url: string,
  ): Promise<SandboxUrlFetchResult> {
    this.#validateToolContext(context);
    const tools = this.#requireTools();
    return this.#costed(
      context,
      {
        provider: "ssrf-guarded-fetcher",
        resourceType: "sandbox.url.fetch",
        units: 1,
      },
      async () => {
        const fetched = await tools.urlFetcher.fetch(url);
        if (fetched.body.byteLength > MAX_TOOL_OUTPUT_BYTES) {
          throw new Error("URL fetch response exceeds sandbox output limit");
        }
        return {
          statusCode: fetched.statusCode,
          body: new TextDecoder().decode(fetched.body),
          finalUrl: fetched.finalUrl,
        };
      },
    );
  }

  async executeDatabaseOperation(
    context: SandboxToolCallContext,
    request: DatabaseOperationRequest,
  ): Promise<DatabaseOperationResult> {
    this.#validateToolContext(context);
    this.#assertDatabaseCredentialOwnedBy(
      request.credentialReference,
      context.tenantId,
      request.databaseId,
    );
    const tools = this.#requireTools();
    return this.#costed(
      context,
      {
        provider: tools.database.providerId,
        resourceType: `sandbox.database.${request.operation}`,
        units: 1,
      },
      async () => {
        if (!DATABASE_OPERATIONS.has(request.operation)) {
          throw new Error("Database operation is not supported");
        }
        const permission = await tools.config.resolveToolPermission({
          tenantId: context.tenantId,
          toolName: `database.${request.operation}`,
        });
        const databaseScope = `database:${request.databaseId}`;
        if (
          !permission.allowed ||
          (!permission.requiredScopes.includes(databaseScope) &&
            !permission.requiredScopes.includes("database:*"))
        ) {
          throw new Error("Database operation is not permitted for this tenant");
        }
        const result = await tools.database.execute(request);
        this.#requireBoundedOutput(JSON.stringify(result));
        return result;
      },
    );
  }

  async calculate(
    context: SandboxToolCallContext,
    expression: string,
  ): Promise<number> {
    this.#validateToolContext(context);
    return this.#costed(
      context,
      {
        provider: "sandbox-calculator",
        resourceType: "sandbox.calculator.compute",
        units: 1,
      },
      async () => evaluateExpression(expression),
    );
  }

  #browserScope(
    context: SandboxToolCallContext,
    sandboxSessionId: string,
  ): BrowserSessionScope {
    return {
      tenantId: context.tenantId,
      runId: context.runId,
      nodeExecutionId: context.nodeExecutionId,
      sandboxSessionId,
    };
  }

  async #costed<T>(
    context: SandboxToolCallContext,
    usage: CostUsage,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation();
      await this.#emitCostEventBestEffort(context, usage, "success");
      return result;
    } catch (error: unknown) {
      await this.#emitCostEventBestEffort(context, usage, "error");
      throw error;
    }
  }

  async #emitCostEventBestEffort(
    context: SandboxToolCallContext,
    usage: CostUsage,
    outcome: "success" | "error",
  ): Promise<void> {
    const tools = this.#requireTools();
    const event = {
      tenant_id: context.tenantId,
      cost_event_id: this.#mintCostEventId(),
      run_id: context.runId,
      node_execution_id: context.nodeExecutionId,
      provider_reference: usage.provider,
      usage_json: JSON.stringify({
        resource_type: usage.resourceType,
        provider: usage.provider,
        units: usage.units,
        outcome,
        request_id: context.requestId,
        trace_id: context.traceId,
      }),
      amount_json: JSON.stringify({ usd: 0, estimated: true }),
    } satisfies Readonly<Record<string, JsonValue>>;
    try {
      await tools.costQueue.publish(tools.costEventsQueueName, event);
    } catch {
      // Match Model/Tool Gateway telemetry pattern: queue outage cannot turn
      // an otherwise valid tool result into an execution failure.
    }
  }

  #requireTools(): SandboxToolDependencies {
    if (this.tools === undefined) {
      throw new Error("Sandbox tool dependencies are not configured");
    }
    return this.tools;
  }

  #validateToolContext(context: SandboxToolCallContext): void {
    this.#requirePrefixedUuidV7(context.tenantId, "ten", "tenantId");
    this.#requirePrefixedUuidV7(context.runId, "run", "runId");
    this.#requirePrefixedUuidV7(
      context.nodeExecutionId,
      "node",
      "nodeExecutionId",
    );
    this.#requirePrefixedUuidV7(context.requestId, "req", "requestId");
    this.#requirePrefixedUuidV7(context.traceId, "trc", "traceId");
  }

  #requirePrefixedUuidV7(
    value: string,
    prefix: string,
    field: string,
  ): void {
    if (!new RegExp(`^${prefix}_${UUID_V7_BODY}$`, "i").test(value)) {
      throw new Error(`${field} must be a ${prefix}_ prefixed UUIDv7`);
    }
  }

  #assertDatabaseCredentialOwnedBy(
    reference: string,
    tenantId: string,
    databaseId: string,
  ): void {
    const segments = reference.split("/").filter(Boolean);
    if (
      segments.length < 7 ||
      segments[0] !== "alter" ||
      segments[2] !== "tenant" ||
      segments[3] !== tenantId ||
      segments[4] !== "integration" ||
      segments[5] !== databaseId
    ) {
      throw new Error(
        "Database credential reference is not owned by this tenant/database",
      );
    }
  }

  #requireBoundedOutput(output: string): void {
    if (Buffer.byteLength(output, "utf8") > MAX_TOOL_OUTPUT_BYTES) {
      throw new Error("Sandbox tool output exceeds maximum payload");
    }
  }

  #requireSession(sessionId: string): void {
    if (sessionId.trim().length === 0) throw new Error("sessionId is required");
  }

  #requireWorkspacePath(path: string): void {
    if (
      !path.startsWith(`${WORKSPACE}/`) ||
      path.includes("\\") ||
      path.split("/").includes("..")
    ) {
      throw new Error("Sandbox paths must remain under /workspace");
    }
  }

  #missingPackages(stderr: string): Set<string> {
    const packages = new Set<string>();
    for (const pattern of MISSING_IMPORT_PATTERNS) {
      for (const match of stderr.matchAll(pattern)) {
        const packageName = this.#packageNameFromImport(match[1] ?? "");
        if (packageName) packages.add(packageName);
      }
    }
    return packages;
  }

  #packageNameFromImport(importPath: string): string | undefined {
    if (
      importPath.startsWith(".") ||
      importPath.startsWith("/") ||
      importPath.startsWith("@/") ||
      importPath.startsWith("~/") ||
      importPath.startsWith("#") ||
      importPath.startsWith("node:")
    ) {
      return undefined;
    }
    const segments = importPath.split("/");
    const candidate = importPath.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0]?.split(".")[0];
    return candidate && !NODE_BUILT_INS.has(candidate) ? candidate : undefined;
  }
}
