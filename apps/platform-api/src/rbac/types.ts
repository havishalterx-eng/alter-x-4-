export const tenantRoles = ["owner", "admin", "billing", "member"] as const;
export const workspaceRoles = [
  "admin",
  "editor",
  "operator",
  "approver",
  "viewer",
] as const;
export const staffRoles = ["staff_admin", "staff_support", "staff_billing_ops", "staff_security"] as const;

export type TenantRole = (typeof tenantRoles)[number];
export type WorkspaceRole = (typeof workspaceRoles)[number];
export type StaffRole = (typeof staffRoles)[number];
export type RbacRole = TenantRole | WorkspaceRole;

export interface ActorContext {
  user_id: string;
  tenant_id: string;
  workspace_id?: string;
  roles: string[];
  permissions: string[];
  session_id: string;
  auth_time?: number;
  // ENGINE-FIX-P5-1: per-workspace role bindings, kept alongside the flat
  // `roles` array. The flat array exists for tenant-role checks and
  // permission derivation; it must never be used to answer a
  // @RequireWorkspaceRole question about a SPECIFIC workspace -- an actor
  // who is admin of workspace A is not thereby admin of workspace B in the
  // same tenant. RbacGuard consults this list (via the request's resolved
  // target workspace) instead.
  workspaceRoles?: readonly WorkspaceRoleBinding[];
}

export interface WorkspaceRoleBinding {
  readonly workspaceId: string;
  readonly role: string;
}

export interface RbacRequest {
  actorContext?: ActorContext;
  staffActorContext?: StaffActorContext;
  params?: Record<string, string | undefined>;
  url?: string;
}
export interface StaffActorContext { staff_user_id: string; identity_ref: string; email: string; roles: StaffRole[]; }
export function staffRoleAllows(actual: string, required: StaffRole): boolean { return actual === required; }

export function tenantRoleAllows(actual: string, required: TenantRole): boolean {
  const ranks: Record<TenantRole, number> = {
    owner: 4,
    admin: 3,
    billing: 2,
    member: 1,
  };

  if (!isTenantRole(actual)) {
    return false;
  }

  return ranks[actual] >= ranks[required];
}

export function workspaceRoleAllows(actual: string, required: WorkspaceRole): boolean {
  return actual === required;
}

function isTenantRole(role: string): role is TenantRole {
  return tenantRoles.includes(role as TenantRole);
}
