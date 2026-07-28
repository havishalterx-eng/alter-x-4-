import type { SandboxCommandResult, SandboxFile, SandboxProvider } from "@alterx/shared-clients";

const WORKSPACE = "/workspace";
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "pip"]);
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

export class SandboxService {
  constructor(private readonly sandbox: SandboxProvider) {}

  async writeFiles(sessionId: string, files: readonly SandboxFile[]): Promise<void> {
    this.#requireSession(sessionId);
    for (const file of files) this.#requireWorkspacePath(file.path);
    await this.sandbox.writeFiles(sessionId, files);
  }

  async readFile(sessionId: string, path: string): Promise<string> {
    this.#requireSession(sessionId);
    this.#requireWorkspacePath(path);
    return this.sandbox.readFile(sessionId, path);
  }

  async execute(sessionId: string, command: string, timeoutMs?: number): Promise<SandboxCommandResult> {
    this.#requireSession(sessionId);
    if (command.trim().length === 0 || FORBIDDEN_COMMANDS.some((pattern) => pattern.test(command))) {
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

  async installPackage(sessionId: string, manager: string, packageName: string): Promise<SandboxCommandResult> {
    this.#requireSession(sessionId);
    if (
      !PACKAGE_MANAGERS.has(manager) ||
      !/^[A-Za-z0-9@._/-]+$/.test(packageName) ||
      packageName.split("/").includes("..")
    ) {
      throw new Error("Package manager or package name is invalid");
    }
    const command = manager === "pip" ? `pip install ${packageName}` : `${manager} install ${packageName}`;
    return this.sandbox.execute(sessionId, command);
  }

  #requireSession(sessionId: string): void {
    if (sessionId.trim().length === 0) throw new Error("sessionId is required");
  }

  #requireWorkspacePath(path: string): void {
    if (!path.startsWith(`${WORKSPACE}/`) || path.includes("\\") || path.split("/").includes("..")) {
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
