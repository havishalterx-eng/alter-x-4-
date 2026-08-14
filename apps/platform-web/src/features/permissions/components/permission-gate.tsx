import * as React from "react"
import { type Permission } from "@/api/types"
import { usePermissions } from "../hooks/usePermissions"

interface PermissionGateProps {
  permission: Permission
  fallback?: React.ReactNode
  children: React.ReactNode
  behavior?: "hide" | "disable"
}

export function PermissionGate({
  permission,
  fallback = null,
  children,
  behavior = "hide",
}: PermissionGateProps) {
  const { can } = usePermissions()
  const hasPermission = can(permission)

  if (hasPermission) {
    return <>{children}</>
  }

  if (behavior === "hide") {
    return <>{fallback}</>
  }

  // If behavior is "disable", we assume children is a single React element
  // and we clone it to inject the disabled prop.
  if (React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      disabled: true,
      "aria-disabled": true,
      title: "You do not have permission to perform this action.",
    })
  }

  return <>{fallback}</>
}
