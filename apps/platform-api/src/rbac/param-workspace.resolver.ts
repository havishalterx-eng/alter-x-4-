import { EngineClient } from "../engine/engine-client";
import type { EngineCallerContext } from "../engine/types";
import type { RbacRequest } from "./types";

/**
 * Resolves the workspace that owns the resource a request addresses, so
 * RbacGuard can check a @RequireWorkspaceRole against THAT workspace
 * instead of the actor's any-workspace union (ENGINE-FIX-P5-1: an admin of
 * workspace A must not pass workspace B's admin gate just because both sit
 * in the same tenant).
 *
 * Returns:
 *   - a workspace id  -> guard checks the role against this workspace
 *   - undefined       -> route names no resolvable workspace; guard keeps
 *                        the legacy flat-role behavior for it (documented
 *                        limitation for collections and for families whose
 *                        ownership lives behind other lookups)
 */
export interface ResourceWorkspaceResolver {
  resolveWorkspaceId(request: RbacRequest): Promise<string | undefined>;
}

export class WorkspaceLookupUnavailableError extends Error {
  constructor() {
    super("Workspace ownership could not be resolved");
    this.name = "WorkspaceLookupUnavailableError";
  }
}

export interface ProjectWorkspaceLookup {
  /** The project's owning workspace, or undefined when no such project
   * exists for the tenant ("doesn't exist" and "isn't yours" collapse).
   * Throws WorkspaceLookupUnavailableError when the backing system cannot
   * be consulted -- callers must fail closed on it. */
  getProjectWorkspace(tenantId: string, projectId: string): Promise<string | undefined>;
}

const PROJECT_POSITIVE_TTL_MS = 60 * 1000;
const PROJECT_NEGATIVE_TTL_MS = 15 * 1000;

interface CacheEntry {
  readonly workspaceId: string | undefined;
  readonly expiresAtMs: number;
}

/** Engine-backed lookup for :projectId routes. platform_db owns no projects
 * table -- projects live in orchestration-service, so ownership comes from
 * its GET /api/v1/projects/:id (tenant-scoped server-side; a foreign
 * tenant's project is indistinguishable from a missing one). Positive
 * entries cache 60s, negative 15s: enough to keep the common read path off
 * the engine without making a freshly-moved project's old workspace sticky
 * for long. Lookup failures are NEVER cached -- an outage degrades to
 * fail-closed denials, not to stale grants. */
export class EngineProjectWorkspaceLookup implements ProjectWorkspaceLookup {
  readonly #cache = new Map<string, CacheEntry>();
  readonly #engineClient: EngineClient;
  readonly #now: () => number;

  constructor(
    engineClient: EngineClient,
    now: () => number = () => Date.now(),
  ) {
    this.#engineClient = engineClient;
    this.#now = now;
  }

  async getProjectWorkspace(tenantId: string, projectId: string): Promise<string | undefined> {
    const cacheKey = `${tenantId}:${projectId}`;
    const cached = this.#cache.get(cacheKey);
    const currentTime = this.#now();
    if (cached && cached.expiresAtMs > currentTime) {
      if (cached.workspaceId === undefined) return undefined;
      return cached.workspaceId;
    }

    let response: { status: number; body?: { workspace_id?: unknown } };
    try {
      // Context fields beyond tenant identity are unused by this internal
      // read path's authorization; empty strings keep the caller contract
      // satisfied without inventing session state.
      const context: EngineCallerContext = {
        userId: "",
        tenantId,
        workspaceId: "",
        sessionId: "",
        authTime: 0,
        roles: [],
        permissions: [],
        traceparent: "",
      };
      response = await this.#engineClient.get<{ workspace_id?: unknown }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}`,
        context,
      );
    } catch (error: unknown) {
      void error;
      throw new WorkspaceLookupUnavailableError();
    }

    if (response.status === 404) {
      this.#cache.set(cacheKey, { workspaceId: undefined, expiresAtMs: currentTime + PROJECT_NEGATIVE_TTL_MS });
      return undefined;
    }
    if (response.status !== 200) {
      throw new WorkspaceLookupUnavailableError();
    }
    const workspaceId =
      typeof response.body?.workspace_id === "string" && response.body.workspace_id.length > 0
        ? response.body.workspace_id
        : undefined;
    if (workspaceId === undefined) {
      throw new WorkspaceLookupUnavailableError();
    }
    this.#cache.set(cacheKey, { workspaceId, expiresAtMs: currentTime + PROJECT_POSITIVE_TTL_MS });
    return workspaceId;
  }
}

/** Route-param-aware workspace resolution: a direct workspaceId param wins;
 * a projectId param resolves through the ProjectWorkspaceLookup when one is
 * wired; without a lookup, or when the route names neither, the route stays
 * unbound and RbacGuard keeps the legacy flat-role behavior. */
export class ParamWorkspaceResolver implements ResourceWorkspaceResolver {
  constructor(
    private readonly projectLookup?: ProjectWorkspaceLookup | undefined,
  ) {}

  async resolveWorkspaceId(request: RbacRequest): Promise<string | undefined> {
    const params = request.params ?? {};
    const directWorkspaceId = params.workspaceId ?? params.workspace_id;
    if (directWorkspaceId) {
      return directWorkspaceId;
    }
    const projectId = params.projectId ?? params.project_id;
    if (!projectId || this.projectLookup === undefined) {
      return undefined;
    }
    const actorTenantId = request.actorContext?.tenant_id;
    if (!actorTenantId) {
      return undefined;
    }
    return this.projectLookup.getProjectWorkspace(actorTenantId, projectId);
  }
}
