import {
  BedrockAgentCoreClient,
  InvokeCodeInterpreterCommand,
  StartCodeInterpreterSessionCommand,
  StopCodeInterpreterSessionCommand,
  ToolName,
} from "@aws-sdk/client-bedrock-agentcore";

import type { ProviderCapabilities } from "@alterx/contracts";
import type {
  ProviderHealth,
  ProviderMetadata,
  SandboxCommandResult,
  SandboxFile,
  SandboxProvider,
  SandboxSession,
  SandboxSessionCreateRequest,
} from "@alterx/shared-clients";

export interface AgentCoreSandboxProviderConfig {
  readonly region: string;
  readonly sessionTimeoutSeconds?: number;
}

export interface AgentCoreCommandClient {
  send(command: StartCodeInterpreterSessionCommand): Promise<{
    readonly sessionId?: string;
  }>;
  send(command: InvokeCodeInterpreterCommand): Promise<{
    readonly stream?: AsyncIterable<{
      readonly result?: {
        readonly isError?: boolean;
        readonly structuredContent?: {
          readonly stdout?: string;
          readonly stderr?: string;
          readonly exitCode?: number;
        };
        readonly content?: readonly { readonly text?: string }[];
      };
    }>;
  }>;
  send(command: StopCodeInterpreterSessionCommand): Promise<unknown>;
  destroy?(): void;
}

const CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  tool_calling: false,
  vision: false,
  structured_output: true,
  long_context: false,
  regional_availability: ["ap-south-1"],
  data_residency: ["IN"],
  batch_support: false,
  maximum_payload: 1_048_576,
  supported_languages: ["en"],
  cost_model: { rates: [] },
};

const METADATA: ProviderMetadata<"SandboxProvider"> = {
  providerId: "agentcore",
  interfaceName: "SandboxProvider",
  displayName: "Bedrock AgentCore Code Interpreter",
  version: "execution-v1",
  telemetryNamespace: "alterx.adapters.agentcore.sandbox",
  supportsTenantOverrides: false,
  migration: { strategyVersion: "agentcore-v1", rollbackSupported: true },
};

const DEFAULT_SESSION_TIMEOUT_SECONDS = 60 * 60;

export class AgentCoreSandboxProvider implements SandboxProvider {
  readonly metadata = METADATA;
  readonly capabilities = CAPABILITIES;

  readonly #client: AgentCoreCommandClient;
  readonly #sessionTimeoutSeconds: number;
  readonly #sessions = new Map<string, string>();

  constructor(config: AgentCoreSandboxProviderConfig, client?: AgentCoreCommandClient) {
    if (config.region.trim().length === 0) {
      throw new Error("AgentCore region is required");
    }
    this.#sessionTimeoutSeconds = config.sessionTimeoutSeconds ?? DEFAULT_SESSION_TIMEOUT_SECONDS;
    if (!Number.isInteger(this.#sessionTimeoutSeconds) || this.#sessionTimeoutSeconds < 1) {
      throw new Error("AgentCore session timeout must be positive");
    }
    this.#client = client ?? new BedrockAgentCoreClient({ region: config.region });
  }

  async createSession(request: SandboxSessionCreateRequest): Promise<SandboxSession> {
    const response = await this.#client.send(
      new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: request.templateId,
        sessionTimeoutSeconds: this.#sessionTimeoutSeconds,
      }),
    );
    const sessionId = response.sessionId;
    if (sessionId === undefined) {
      throw new Error("AgentCore did not return a session identifier");
    }
    this.#sessions.set(sessionId, request.templateId);
    return {
      sessionId,
      expiresAt: new Date(Date.now() + this.#sessionTimeoutSeconds * 1000).toISOString(),
    };
  }

  async writeFiles(sessionId: string, files: readonly SandboxFile[]): Promise<void> {
    const codeInterpreterIdentifier = this.#requireSession(sessionId);
    await this.#invoke(codeInterpreterIdentifier, sessionId, ToolName.WRITE_FILES, {
      content: files.map((file) => ({ path: file.path, text: file.content })),
    });
  }

  async readFile(sessionId: string, path: string): Promise<string> {
    const codeInterpreterIdentifier = this.#requireSession(sessionId);
    const result = await this.#invoke(codeInterpreterIdentifier, sessionId, ToolName.READ_FILES, {
      paths: [path],
    });
    const text = result.content?.map((block) => block.text ?? "").join("");
    if (text === undefined) {
      throw new Error(`AgentCore returned no content for ${path}`);
    }
    return text;
  }

  async execute(sessionId: string, command: string, timeoutMs?: number): Promise<SandboxCommandResult> {
    const codeInterpreterIdentifier = this.#requireSession(sessionId);
    const result = await this.#invoke(
      codeInterpreterIdentifier,
      sessionId,
      ToolName.EXECUTE_COMMAND,
      { command },
      timeoutMs,
    );
    return {
      exitCode: result.structuredContent?.exitCode ?? (result.isError ? 1 : 0),
      stdout: result.structuredContent?.stdout ?? result.content?.map((block) => block.text ?? "").join("") ?? "",
      stderr: result.structuredContent?.stderr ?? "",
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    const codeInterpreterIdentifier = this.#sessions.get(sessionId);
    if (codeInterpreterIdentifier === undefined) return;
    await this.#client.send(
      new StopCodeInterpreterSessionCommand({ codeInterpreterIdentifier, sessionId }),
    );
    this.#sessions.delete(sessionId);
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { status: "healthy", checkedAt: new Date().toISOString(), latencyMs: 0, details: { configured: true, liveProbe: false } };
  }

  #requireSession(sessionId: string): string {
    const codeInterpreterIdentifier = this.#sessions.get(sessionId);
    if (codeInterpreterIdentifier === undefined) {
      throw new Error("Sandbox session was not found");
    }
    return codeInterpreterIdentifier;
  }

  async #invoke(
    codeInterpreterIdentifier: string,
    sessionId: string,
    name: (typeof ToolName)[keyof typeof ToolName],
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<{
    isError?: boolean;
    structuredContent?: { stdout?: string; stderr?: string; exitCode?: number };
    content?: readonly { text?: string }[];
  }> {
    const invocation = this.#client.send(
      new InvokeCodeInterpreterCommand({
        codeInterpreterIdentifier,
        sessionId,
        name,
        arguments: args,
      }),
    );
    const response = await (timeoutMs === undefined ? invocation : withTimeout(invocation, timeoutMs));
    if (response.stream === undefined) {
      throw new Error("AgentCore returned no result stream");
    }
    for await (const event of response.stream) {
      if (event.result !== undefined) {
        return event.result;
      }
    }
    throw new Error("AgentCore stream ended without a result");
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("AgentCore command timed out")), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
