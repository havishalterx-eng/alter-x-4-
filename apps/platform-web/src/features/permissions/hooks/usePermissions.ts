import { create } from "zustand"
import { type Permission, type WorkspaceRole } from "@/api/types"
import { ROLE_PERMISSIONS } from "../roles"

interface PermissionsState {
  // In a real app this would be populated from the API based on the current workspace context
  role: WorkspaceRole
  setMockRole: (role: WorkspaceRole) => void
}

const usePermissionsStore = create<PermissionsState>((set) => ({
  role: "owner", // default mock role
  setMockRole: (role) => set({ role }),
}))

export function usePermissions() {
  const { role, setMockRole } = usePermissionsStore()

  const permissions = ROLE_PERMISSIONS[role] || []

  const can = (permission: Permission) => {
    return permissions.includes(permission)
  }

  const canAll = (requiredPermissions: Permission[]) => {
    return requiredPermissions.every(p => can(p))
  }

  const canAny = (requiredPermissions: Permission[]) => {
    return requiredPermissions.some(p => can(p))
  }

  return {
    role,
    permissions,
    can,
    canAll,
    canAny,
    setMockRole, // Exported for dev tools only
  }
}
