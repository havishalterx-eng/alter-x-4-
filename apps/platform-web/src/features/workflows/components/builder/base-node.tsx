import * as React from "react"
import { Handle, Position } from "@xyflow/react"
import { Settings2, Code, GitBranch, Zap, Network, Bot, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

// Helper to map category to icon
const categoryIcons: Record<string, React.ElementType> = {
  Triggers: Zap,
  AI: Bot,
  Logic: GitBranch,
  Actions: Network,
  Data: Code,
}

interface BaseNodeData {
  label: string
  category: string
  status?: "default" | "configured" | "warning" | "error"
  [key: string]: any
}

export function BaseNode({ data, selected }: { data: BaseNodeData; selected?: boolean }) {
  const Icon = categoryIcons[data.category] || Settings2

  return (
    <div
      className={cn(
        "min-w-[180px] rounded-xl border bg-surface shadow-sm transition-all",
        selected ? "border-primary ring-1 ring-primary shadow-md" : "border-border hover:border-foreground/20",
        data.status === "warning" && "border-amber-500",
        data.status === "error" && "border-red-500"
      )}
    >
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-foreground/70">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 overflow-hidden">
          <p className="truncate text-sm font-medium leading-none text-foreground">{data.label}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{data.category}</p>
        </div>
        {data.status === "warning" && <AlertTriangle className="h-4 w-4 text-amber-500" />}
      </div>

      <Handle
        type="target"
        position={Position.Top}
        className="h-3 w-3 border-2 border-surface bg-muted-foreground/30 hover:bg-primary hover:border-primary"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="h-3 w-3 border-2 border-surface bg-muted-foreground/30 hover:bg-primary hover:border-primary"
      />
    </div>
  )
}
