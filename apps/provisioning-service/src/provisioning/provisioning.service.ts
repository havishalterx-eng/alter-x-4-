import type { SandboxProvider, SecretsProvider } from "@alterx/shared-clients";

export interface ScaffoldFile { readonly path: string; readonly content: string; }
export interface ProvisionRequest {
  readonly tenantId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly cycleId: string;
  readonly templateId: string;
  readonly environmentRefs: Readonly<Record<string, string>>;
  readonly scaffold: readonly ScaffoldFile[];
}
export interface ProvisionedSandbox { readonly sessionId: string; readonly projectDirectory: string; readonly reused: boolean; }

function requireIdentifier(value: string, field: string): void {
  if (value.trim().length === 0 || /[\\/]/.test(value)) throw new Error(`${field} is required and cannot contain a path separator`);
}
function projectDirectory(projectId: string): string { return `/workspace/${projectId}`; }
function safePath(path: string): boolean { return path.length > 0 && !path.startsWith("/") && !path.split("/").includes(".."); }

export class ProvisioningService {
  readonly #active = new Map<string, Promise<ProvisionedSandbox>>();
  readonly #sessions = new Map<string, string>();
  constructor(private readonly sandbox: SandboxProvider, private readonly secrets: SecretsProvider) {}

  provision(request: ProvisionRequest): Promise<ProvisionedSandbox> {
    requireIdentifier(request.tenantId, "tenantId"); requireIdentifier(request.runId, "runId");
    requireIdentifier(request.projectId, "projectId"); requireIdentifier(request.cycleId, "cycleId");
    if (request.templateId.trim().length === 0) throw new Error("templateId is required");
    if (request.scaffold.some((file) => !safePath(file.path))) throw new Error("Scaffold paths must be relative and cannot traverse directories");
    const key = `${request.tenantId}:${request.runId}:${request.projectId}:${request.cycleId}`;
    const existing = this.#active.get(key);
    if (existing !== undefined) return existing.then((result) => ({ ...result, reused: true }));
    const task = this.create(key, request);
    this.#active.set(key, task);
    return task;
  }

  async closeCycle(tenantId: string, runId: string, projectId: string, cycleId: string): Promise<void> {
    const key = `${tenantId}:${runId}:${projectId}:${cycleId}`;
    const sessionId = this.#sessions.get(key);
    if (sessionId !== undefined) await this.sandbox.closeSession(sessionId);
    this.#sessions.delete(key); this.#active.delete(key);
  }

  private async create(key: string, request: ProvisionRequest): Promise<ProvisionedSandbox> {
    const environment = Object.fromEntries(await Promise.all(Object.entries(request.environmentRefs).map(async ([name, ref]) => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("Environment variable names must be uppercase identifiers");
      return [name, await this.secrets.getSecret(ref)] as const;
    })));
    const session = await this.sandbox.createSession({ tenantId: request.tenantId, runId: request.runId, cycleId: request.cycleId, templateId: request.templateId, environment });
    const directory = projectDirectory(request.projectId);
    try {
      await this.sandbox.writeFiles(session.sessionId, request.scaffold.map((file) => ({ path: `${directory}/${file.path}`, content: file.content })));
      this.#sessions.set(key, session.sessionId);
      return { sessionId: session.sessionId, projectDirectory: directory, reused: false };
    } catch (error) {
      await this.sandbox.closeSession(session.sessionId);
      this.#active.delete(key);
      throw error;
    }
  }
}
