import { Sandbox } from "e2b";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ProviderHealth,
  ProviderMetadata,
  SandboxFile,
  SandboxCommandResult,
  SandboxProvider,
  SandboxSession,
  SandboxSessionCreateRequest,
} from "@alterx/shared-clients";

export interface E2bSandboxHandle {
  readonly sandboxId: string;
  readonly files: {
    write(files: readonly { path: string; data: string }[]): Promise<void>;
    read(path: string): Promise<string>;
  };
  readonly commands: { run(command: string, options?: { timeoutMs?: number }): Promise<SandboxCommandResult> };
  kill(): Promise<void>;
}

export interface E2bSandboxFactory {
  create(
    templateId: string,
    options: { apiKey: string; timeoutMs: number; envs: Readonly<Record<string, string>> },
  ): Promise<E2bSandboxHandle>;
}

export interface E2bSandboxProviderConfig {
  readonly apiKey: string;
  readonly timeoutMs?: number;
}

const CAPABILITIES: ProviderCapabilities = {
  streaming: false, tool_calling: false, vision: false, structured_output: true,
  long_context: false, regional_availability: ["ap-south-1"], data_residency: ["IN"],
  batch_support: false, maximum_payload: 1_048_576, supported_languages: ["en"], cost_model: { rates: [] },
};

const METADATA: ProviderMetadata<"SandboxProvider"> = {
  providerId: "e2b", interfaceName: "SandboxProvider", displayName: "E2B Sandbox",
  version: "execution-v1", telemetryNamespace: "alterx.adapters.e2b.sandbox",
  supportsTenantOverrides: false, migration: { strategyVersion: "e2b-v1", rollbackSupported: true },
};

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

function factory(): E2bSandboxFactory {
  return {
    create: async (templateId, options) => {
      const sandbox = await Sandbox.create(templateId, options);
      return {
        sandboxId: sandbox.sandboxId,
        files: {
          write: async (files) => {
            await sandbox.files.write(files.map((file) => ({ path: file.path, data: file.data })));
          },
          read: async (path) => sandbox.files.read(path),
        },
        commands: { run: async (command, options) => sandbox.commands.run(command, options) },
        kill: async () => { await sandbox.kill(); },
      };
    },
  };
}

export class E2bSandboxProvider implements SandboxProvider {
  readonly metadata = METADATA;
  readonly capabilities = CAPABILITIES;
  readonly #sessions = new Map<string, E2bSandboxHandle>();
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #factory: E2bSandboxFactory;

  constructor(config: E2bSandboxProviderConfig, client: E2bSandboxFactory = factory()) {
    if (config.apiKey.trim().length === 0) throw new Error("E2B API key is required");
    this.#apiKey = config.apiKey;
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1) throw new Error("E2B timeout must be positive");
    this.#factory = client;
  }

  async createSession(request: SandboxSessionCreateRequest): Promise<SandboxSession> {
    const sandbox = await this.#factory.create(request.templateId, {
      apiKey: this.#apiKey, timeoutMs: this.#timeoutMs, envs: request.environment,
    });
    this.#sessions.set(sandbox.sandboxId, sandbox);
    return { sessionId: sandbox.sandboxId, expiresAt: new Date(Date.now() + this.#timeoutMs).toISOString() };
  }

  async writeFiles(sessionId: string, files: readonly SandboxFile[]): Promise<void> {
    const sandbox = this.#sessions.get(sessionId);
    if (sandbox === undefined) throw new Error("Sandbox session was not found");
    await sandbox.files.write(files.map((file) => ({ path: file.path, data: file.content })));
  }

  async readFile(sessionId: string, path: string): Promise<string> {
    const sandbox = this.#sessions.get(sessionId);
    if (sandbox === undefined) throw new Error("Sandbox session was not found");
    return sandbox.files.read(path);
  }

  async execute(sessionId: string, command: string, timeoutMs?: number): Promise<SandboxCommandResult> {
    const sandbox = this.#sessions.get(sessionId);
    if (sandbox === undefined) throw new Error("Sandbox session was not found");
    return sandbox.commands.run(command, timeoutMs === undefined ? undefined : { timeoutMs });
  }

  async closeSession(sessionId: string): Promise<void> {
    const sandbox = this.#sessions.get(sessionId);
    if (sandbox === undefined) return;
    await sandbox.kill();
    this.#sessions.delete(sessionId);
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { status: "healthy", checkedAt: new Date().toISOString(), latencyMs: 0, details: { configured: true, liveProbe: false } };
  }
}
