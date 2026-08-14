import { Shield, Key, Eye, User } from "lucide-react"
import { type WorkspaceRole } from "@/api/types"
import { RequirePermission } from "@/features/permissions/components/require-permission"

export function RolesPage() {
  const roles = [
    {
      id: "owner" as WorkspaceRole,
      name: "Owner",
      description: "Full control over the workspace.",
      icon: Shield,
    },
    {
      id: "admin" as WorkspaceRole,
      name: "Admin",
      description: "Manage users, workflows, integrations and operations.",
      icon: Key,
    },
    {
      id: "member" as WorkspaceRole,
      name: "Member",
      description: "Build and operate workflows and projects.",
      icon: User,
    },
    {
      id: "viewer" as WorkspaceRole,
      name: "Viewer",
      description: "Read-only workspace access.",
      icon: Eye,
    }
  ]

  return (
    <RequirePermission permission="role.read">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Roles</h1>
          <p className="text-text-secondary mt-1">View the built-in roles and their permission assignments.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {roles.map(role => (
            <div key={role.id} className="rounded-xl border border-border bg-surface p-6 hover:border-border-strong transition-colors cursor-pointer">
              <div className="flex items-center gap-4 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <role.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-lg font-medium text-text-primary">{role.name}</h3>
              </div>
              <p className="text-sm text-text-secondary">
                {role.description}
              </p>
              <div className="mt-4 text-xs font-medium text-primary">
                View permissions →
              </div>
            </div>
          ))}
        </div>
      </div>
    </RequirePermission>
  )
}
