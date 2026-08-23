import type { BrowserAutomationProvider } from "@alterx/adapters";
import type {
  ConfigProvider,
  JsonValue,
  QueueProvider,
  SandboxCommandResult,
  SandboxFile,
  SandboxProvider,
  SandboxSession,
} from "@alterx/shared-clients";

import { calculate as evaluateExpression } from "./calculator";
import { createCostEventId } from "./cost-event-id";

const WORKSPACE = "/workspace";
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "pip"]);
// Approved sandbox templates. Explicit, no server-side default -- a
// caller must always name one of these, keeping every session's
// environment reproducible and auditable. Extend this set for real,
// named provider-specific template IDs as they're actually adopted;
// never widen it to "anything goes."
const SANDBOX_TEMPLATE_ALLOWLIST = new Set(["base", "node", "python"]);
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
const INFRA_FAILURE_OUTPUT = /(?:ENOTFOUND|ECONNRESET|ETIMEDOUT|network|timeout|no space left|disk full|sandbox)/i;

export type VerificationStatus = "passed" | "logic_failure" | "infra_failure" | "inconclusive";
export type VerificationKind = "build" | "render";
export interface VerificationResult {
  readonly output: { readonly verification: { readonly kind: VerificationKind; readonly status: VerificationStatus; readonly errorCode?: string; readonly detail?: string; }; };
  readonly metadata: Record<string, unknown>;
}

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

export interface SandboxToolDependencies {
  readonly browser: BrowserAutomationProvider;
  readonly config: ConfigProvider;
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

  /** Explicit template_id only -- no silent default. Rejects anything
   * outside SANDBOX_TEMPLATE_ALLOWLIST before ever reaching the real
   * provider, so a typo'd or unapproved template can never silently boot
   * the wrong environment. cycleId is required by SandboxProvider's
   * interface but genuinely unused by both real providers today (E2B and
   * AgentCore only read templateId/environment, confirmed by reading
   * both) -- reuses runId rather than inventing new, currently-inert
   * semantics for it. */
  async createSession(request: {
    readonly tenantId: string;
    readonly runId: string;
    readonly templateId: string;
    readonly environment: Readonly<Record<string, string>>;
  }): Promise<SandboxSession> {
    if (!SANDBOX_TEMPLATE_ALLOWLIST.has(request.templateId)) {
      throw new Error(
        `Sandbox templateId "${request.templateId}" is not in the approved allowlist`,
      );
    }
    return this.sandbox.createSession({
      tenantId: request.tenantId,
      runId: request.runId,
      cycleId: request.runId,
      templateId: request.templateId,
      environment: request.environment,
    });
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

  /** Idempotent: closing an already-closed or unknown session is not an
   * error -- the post-condition (this sessionId is closed) holds either
   * way, matching SandboxProvider.closeSession's own void/no-signal
   * semantics (it silently no-ops on an unknown session today). */
  async closeSession(sessionId: string): Promise<void> {
    this.#requireSession(sessionId);
    await this.sandbox.closeSession(sessionId);
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

  async verifyBuild(sessionId: string, command = "pnpm build", timeoutMs?: number): Promise<VerificationResult> {
    try {
      const result = await this.execute(sessionId, command, timeoutMs);
      if (result.exitCode === 0) return this.#verification("build", "passed", { exitCode: result.exitCode });
      return this.#verification("build", result.exitCode === 124 || INFRA_FAILURE_OUTPUT.test(`${result.stdout}\n${result.stderr}`) ? "infra_failure" : "logic_failure", { exitCode: result.exitCode }, result.exitCode === 124 || INFRA_FAILURE_OUTPUT.test(`${result.stdout}\n${result.stderr}`) ? "SANDBOX_BUILD_INFRA_FAILURE" : "SANDBOX_BUILD_LOGIC_FAILURE");
    } catch (error) { return this.#verification("build", "infra_failure", {}, "SANDBOX_BUILD_INFRA_FAILURE", this.#safeErrorDetail(error)); }
  }

  // ENGINE-FIX-P3-16 + ENGINE-RESTRUCTURE-P4-1b: verifyRender is the only
  // browser-driving entry point Sandbox still owns, and it stays here by
  // design -- render verification is part of the isolated-computation
  // responsibility (build/lint/test/render) the architecture doc keeps in
  // Sandbox. It is permission-gated ("browser.verify_render") exactly like
  // the five interactive browser methods used to be; those five
  // (createBrowserSession/navigateBrowser/clickBrowser/extractBrowser/
  // closeBrowserSession) moved to tool-gateway's invokeTool as
  // browser.* dispatch (apps/tool-gateway/src/gateway/
  // tool-gateway.service.ts). Earlier, ENGINE-FIX-P3-16 had fixed this
  // method reading tools.browser instead of a separate always-undefined
  // browserVerifier field -- that fix is what makes the remaining
  // tools.browser usage here real.
  async verifyRender(
    context: SandboxToolCallContext,
    previewUrl: string,
    files: readonly SandboxFile[],
    timeoutMs?: number,
  ): Promise<VerificationResult> {
    const placeholders = this.detectPlaceholders(files);
    if (placeholders.length > 0) return this.#verification("render", "logic_failure", { placeholderCount: placeholders.length }, "SANDBOX_RENDER_PLACEHOLDER_DETECTED");
    if (!this.tools) return this.#verification("render", "inconclusive", {}, "SANDBOX_RENDER_BROWSER_UNAVAILABLE");
    try {
      await this.#requireBrowserPermission(this.tools, context, "browser.verify_render");
    } catch {
      return this.#verification("render", "logic_failure", {}, "SANDBOX_RENDER_PERMISSION_DENIED");
    }
    try {
      const page = await this.tools.browser.inspectPage(timeoutMs === undefined ? { url: previewUrl } : { url: previewUrl, timeoutMs });
      if (page.statusCode >= 500) return this.#verification("render", "infra_failure", { statusCode: page.statusCode }, "SANDBOX_RENDER_INFRA_FAILURE");
      if (page.pageError || page.consoleErrors.length > 0 || !page.hasVisibleContent) return this.#verification("render", "logic_failure", { statusCode: page.statusCode, consoleErrorCount: page.consoleErrors.length }, "SANDBOX_RENDER_LOGIC_FAILURE", page.pageError);
      return this.#verification("render", "passed", { statusCode: page.statusCode });
    } catch (error) { return this.#verification("render", "infra_failure", {}, "SANDBOX_RENDER_INFRA_FAILURE", this.#safeErrorDetail(error)); }
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

  // ENGINE-RESTRUCTURE-P4-1: fetchUrl and executeDatabaseOperation moved
  // to tool-gateway (apps/tool-gateway/src/gateway/tool-gateway.service.ts)
  // -- the architecture doc's own finding is that Sandbox should own
  // isolated computation only, not general business/external-tool
  // integrations. Neither had a real caller anywhere in this repo before
  // the move either (grepped the whole tree to confirm) -- a relocation,
  // not a rewire. fetchUrl's real replacement was already fully built and
  // working in tool-gateway before this change (its own InvokeTool/FetchUrl
  // RPCs); executeDatabaseOperation's logic (permission scope check,
  // strict tenant/database credential-ownership check, cost-event
  // emission) is now database.* dispatch inside tool-gateway's invokeTool.
  //
  // ENGINE-RESTRUCTURE-P4-1b: the five interactive browser methods moved
  // the same way (browser.session.create/browser.navigate/browser.click/
  // browser.extract/browser.session.close dispatch cases), completing the
  // Sandbox/Tool Gateway split. Only verifyRender's render-verification
  // usage of tools.browser remains in Sandbox.

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

  async #requireBrowserPermission(
    tools: SandboxToolDependencies,
    context: SandboxToolCallContext,
    toolName: string,
  ): Promise<void> {
    const permission = await tools.config.resolveToolPermission({
      tenantId: context.tenantId,
      toolName,
    });
    if (!permission.allowed) {
      throw new Error("Browser operation is not permitted for this tenant");
    }
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
      // ENGINE-RESTRUCTURE-P4-1b: this used to branch to source="browser"
      // for the sandbox.browser.* resource types; those moved to
      // tool-gateway with the browser tools, so only the Sandbox's own
      // source value remains (cost_events.source CHECK constraint, OUT-1).
      source: "sandbox",
      occurred_at: new Date().toISOString(),
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

  #verification(kind: VerificationKind, status: VerificationStatus, metadata: Record<string, unknown>, errorCode?: string, detail?: string): VerificationResult {
    return { output: { verification: { kind, status, ...(errorCode === undefined ? {} : { errorCode }), ...(detail === undefined ? {} : { detail }) } }, metadata };
  }

  #safeErrorDetail(error: unknown): string { return error instanceof Error ? error.message : "Sandbox verification failed"; }
}
