import * as React from "react"
import { CheckCircle2, Circle, AlertTriangle, RefreshCcw, Loader2 } from "lucide-react"
import { useRunStreamStore } from "../stores/useRunStreamStore"
import { cn } from "@/lib/utils"
import { type NodeExecutionStatus } from "@/api/types"

function StatusIcon({ status, type }: { status: NodeExecutionStatus, attempt?: number, type: string }) {
  if (type === "node.retrying") return <RefreshCcw className="h-5 w-5 text-yellow-500 animate-spin-slow" />
  
  switch (status) {
    case "completed": return <CheckCircle2 className="h-5 w-5 text-emerald-500" />
    case "failed": return <AlertTriangle className="h-5 w-5 text-destructive" />
    case "running": return <Loader2 className="h-5 w-5 text-primary animate-spin" />
    case "skipped": return <Circle className="h-5 w-5 text-muted-foreground" />
    case "waiting": return <Circle className="h-5 w-5 text-yellow-500" />
    default: return <Circle className="h-5 w-5 text-muted-foreground/30" />
  }
}

export function RunTimeline() {
  const { nodeExecutions, selectedNodeId, setSelectedNodeId } = useRunStreamStore()
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Derive an ordered list of nodes from nodeExecutions for the timeline
  // based on startedAt, and if not present, fall back to alphabetical or ID.
  const orderedNodes = React.useMemo(() => {
    return Object.values(nodeExecutions).sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0
      return ta - tb
    })
  }, [nodeExecutions])

  // Get raw events grouped by sequence? No, we will show node executions for the timeline.
  
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [orderedNodes.length])

  return (
    <div className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
      {orderedNodes.length === 0 ? (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm flex-col gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
          <p>Waiting for run events...</p>
        </div>
      ) : (
        <div className="space-y-6 relative">
          <div className="absolute left-[27px] top-4 bottom-4 w-px bg-border" />
          
          {orderedNodes.map((node) => (
            <div 
              key={node.id} 
              className={cn(
                "relative flex gap-4 p-3 rounded-lg cursor-pointer transition-colors border",
                selectedNodeId === node.nodeId 
                  ? "bg-surface-hover/50 border-primary/20" 
                  : "hover:bg-surface-hover/30 border-transparent"
              )}
              onClick={() => setSelectedNodeId(node.nodeId)}
            >
              <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised border border-border shadow-sm">
                <StatusIcon status={node.status} type="" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">{node.nodeName}</h4>
                  {node.durationMs !== undefined && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {node.durationMs < 1000 ? `${node.durationMs}ms` : `${(node.durationMs/1000).toFixed(2)}s`}
                    </span>
                  )}
                </div>
                
                {node.attempt > 1 && (
                  <div className="text-xs text-yellow-500 mt-0.5">Attempt {node.attempt}</div>
                )}
                
                {node.status === "failed" && node.error && (
                  <div className="text-xs text-destructive mt-1 bg-destructive/10 p-2 rounded">
                    {node.error.message}
                  </div>
                )}

                {Boolean(node.metadata?.modelOutput) && (
                  <div className="text-sm mt-2 text-muted-foreground bg-surface-raised p-3 rounded-md border border-border/50 break-words line-clamp-3">
                    {String(node.metadata?.modelOutput)}
                    {node.status === "running" && <span className="animate-pulse ml-1">▋</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
