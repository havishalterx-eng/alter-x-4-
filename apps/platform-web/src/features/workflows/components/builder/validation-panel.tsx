import { AlertTriangle, AlertCircle } from "lucide-react"
import { useBuilderStore } from "../../stores/useBuilderStore"

export function ValidationPanel() {
  const { nodes, edges } = useBuilderStore()
  
  // Basic validation mock
  const issues: any[] = []
  
  const hasTrigger = nodes.some(n => n.data?.category === "Triggers")
  if (!hasTrigger && nodes.length > 0) {
    issues.push({ type: "error", message: "Workflow must have at least one trigger node." })
  }
  
  nodes.forEach(n => {
    const hasEdges = edges.some(e => e.source === n.id || e.target === n.id)
    if (!hasEdges && nodes.length > 1) {
      issues.push({ type: "warning", message: `Node "${n.data.label}" is disconnected.` })
    }
  })

  if (issues.length === 0) {
    return null
  }

  return (
    <div className="absolute bottom-4 left-4 z-10 w-80 rounded-lg border border-border bg-surface p-4 shadow-lg">
      <h4 className="mb-3 text-sm font-semibold text-foreground">Workflow Checks</h4>
      <div className="space-y-2">
        {issues.map((issue, i) => (
          <div key={i} className="flex gap-2 text-sm">
            {issue.type === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            )}
            <span className={issue.type === "error" ? "text-red-500 font-medium" : "text-amber-500"}>
              {issue.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
