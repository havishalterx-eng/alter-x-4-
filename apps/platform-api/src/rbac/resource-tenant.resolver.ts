import type { RbacRequest } from "./types";

export interface ResourceTenantResolver {
  resolveTenantId(request: RbacRequest): Promise<string | undefined>;
}

export class RequestParamTenantResolver implements ResourceTenantResolver {
  private readonly workspaceTenants = new Map<string, string>();

  constructor(workspaceTenants: Record<string, string> = {}) {
    for (const [workspaceId, tenantId] of Object.entries(workspaceTenants)) {
      this.workspaceTenants.set(workspaceId, tenantId);
    }
  }

  async resolveTenantId(request: RbacRequest): Promise<string | undefined> {
    const params = request.params ?? {};
    const directTenantId = params.tenantId ?? params.tenant_id;
    if (directTenantId) {
      return directTenantId;
    }

    const workspaceId = params.workspaceId ?? params.workspace_id;
    if (workspaceId) {
      return this.workspaceTenants.get(workspaceId);
    }

    return undefined;
  }
}
