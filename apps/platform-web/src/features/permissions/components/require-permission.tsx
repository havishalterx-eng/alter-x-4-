import * as React from "react"
import { type Permission } from "@/api/types"
import { usePermissions } from "../hooks/usePermissions"
import { PermissionDenied } from "@/components/feedback/permission-denied"

interface RequirePermissionProps {
  permission: Permission
  children: React.ReactNode
}

export function RequirePermission({
  permission,
  children,
}: RequirePermissionProps) {
  const { can } = usePermissions()

  if (!can(permission)) {
    return <PermissionDenied requiredPermission={permission} />
  }

  return <>{children}</>
}
