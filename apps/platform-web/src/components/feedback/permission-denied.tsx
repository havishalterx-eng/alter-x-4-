
import { ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface PermissionDeniedProps {
  className?: string
  requiredPermission?: string
}

export function PermissionDenied({ className, requiredPermission }: PermissionDeniedProps) {
  return (
    <div
      className={cn(
        "flex min-h-[400px] flex-col items-center justify-center p-8 text-center",
        className
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-warning/10 mb-6">
        <ShieldAlert className="h-8 w-8 text-warning" />
      </div>
      <h2 className="text-2xl font-semibold text-text-primary">Access restricted</h2>
      <p className="mt-2 max-w-md text-text-muted">
        You don't have permission to access this area. Contact your workspace administrator if you believe you should have access.
      </p>
      {requiredPermission && import.meta.env.DEV && (
        <div className="mt-4 rounded bg-surface-hover p-2 px-4 font-mono text-xs text-text-secondary border border-border">
          Required: {requiredPermission}
        </div>
      )}
      <div className="mt-8 flex gap-3">
        <Button variant="secondary" onClick={() => window.history.back()}>
          Go Back
        </Button>
      </div>
    </div>
  )
}
