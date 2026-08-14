import * as React from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  description?: string
  primaryAction?: React.ReactNode
  secondaryAction?: React.ReactNode
  className?: string
  children?: React.ReactNode
}

export function PageHeader({
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
  children,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 pb-6", className)}>
      {children}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ax-text">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 text-sm text-ax-text-muted">{description}</p>
          )}
          <div className="mt-3 h-0.5 w-10 rounded-full bg-primary opacity-60" />
        </div>
        {(primaryAction || secondaryAction) && (
          <div className="flex items-center gap-3">
            {secondaryAction}
            {primaryAction}
          </div>
        )}
      </div>
    </div>
  )
}
