import * as React from "react"
import { AlertCircle, WifiOff, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

interface ErrorStateProps {
  title?: string
  description: string
  errorId?: string
  retryAction?: React.ReactNode
  type?: "error" | "warning" | "offline"
  className?: string
}

export function ErrorState({
  title = "Something went wrong",
  description,
  errorId,
  retryAction,
  type = "error",
  className,
}: ErrorStateProps) {
  const isWarning = type === "warning"
  const isOffline = type === "offline"

  const Icon = isOffline ? WifiOff : isWarning ? AlertTriangle : AlertCircle
  
  const bgClass = isOffline 
    ? "border-ax-border bg-ax-surface-hover" 
    : isWarning 
      ? "border-warning/20 bg-warning/5" 
      : "border-red-500/20 bg-red-500/5"
      
  const iconBgClass = isOffline
    ? "bg-ax-surface-2"
    : isWarning
      ? "bg-warning/10"
      : "bg-red-500/10"
      
  const iconColorClass = isOffline
    ? "text-ax-text-muted"
    : isWarning
      ? "text-warning"
      : "text-red-500"

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border p-8 text-center",
        bgClass,
        className
      )}
    >
      <div className={cn("flex h-12 w-12 items-center justify-center rounded-full mb-4", iconBgClass)}>
        <Icon className={cn("h-6 w-6", iconColorClass)} />
      </div>
      <h3 className="text-lg font-semibold text-ax-text">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-ax-text-muted">{description}</p>
      
      {errorId && (
        <p className="mt-4 text-xs font-mono text-ax-text-muted">Error ID: {errorId}</p>
      )}

      {retryAction && (
        <div className="mt-6">
          {retryAction}
        </div>
      )}
    </div>
  )
}
