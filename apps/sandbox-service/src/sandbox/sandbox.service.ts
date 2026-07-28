import type { SandboxCommandResult, SandboxFile, SandboxProvider } from "@alterx/shared-clients";

const WORKSPACE = "/workspace";
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "pip"]);
const FORBIDDEN_COMMANDS = [/\brm\b/, /\bcurl\b[^|]*\|/, /\bwget\b[^|]*\|/];

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
}
