import * as React from "react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  primaryAction?: React.ReactNode
  secondaryAction?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-ax-border p-8 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ax-surface-1 mb-4">
        <Icon className="h-6 w-6 text-ax-text-muted" />
      </div>
      <h3 className="text-lg font-semibold text-ax-text">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-ax-text-muted">{description}</p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="mt-6 flex items-center justify-center gap-3">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
