import { useQuery } from "@tanstack/react-query"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { PageHeader } from "@/components/common/page-header"
import { Badge } from "@/components/ui/badge"
import { ErrorState } from "@/components/feedback/error-state"
import { Button } from "@/components/ui/button"
import { Activity } from "lucide-react"

export function WorkflowHealthList() {
  const { data: healths, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.workflowHealth.all,
    queryFn: () => (api as any).getWorkflowHealths()
  })

  if (isError) {
    return (
      <div className="flex-1 p-8">
        <ErrorState 
          title="Failed to load workflow health"
          description="There was a problem communicating with the server."
          retryAction={<Button onClick={() => refetch()}>Try Again</Button>}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader 
        title="Workflow Health (VACR)" 
        description="Monitor the Validation, Availability, Correctness, and Reliability of your workflows."
      />

      <div className="flex-1 overflow-auto p-8 pt-0">
        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-64 rounded-xl bg-surface-hover animate-pulse" />
            ))}
          </div>
        ) : !healths || healths.length === 0 ? (
          <div className="text-center py-12 text-text-muted">No health data available.</div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {healths.map((health: any) => (
              <HealthCard key={health.workflowId} health={health} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function HealthCard({ health }: { health: any }) {
  const statusColor = 
    health.status === "healthy" ? "text-success" : 
    health.status === "warning" ? "text-warning" : "text-danger"

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="border-b border-border p-5">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="font-semibold text-text-primary">Workflow {health.workflowId}</h3>
          <Badge variant={health.status === "healthy" ? "success" : health.status === "warning" ? "warning" : "danger"}>
            {health.status}
          </Badge>
        </div>
        
        <div className="flex items-end gap-3">
          <div className={`text-4xl font-bold ${statusColor}`}>{health.overallScore}</div>
          <div className="mb-1 text-sm font-medium text-text-muted">Overall Health Score</div>
        </div>
      </div>
      
      <div className="flex-1 p-5">
        <div className="space-y-4">
          <DimensionRow name="Validation" dim={health.dimensions.validation} />
          <DimensionRow name="Availability" dim={health.dimensions.availability} />
          <DimensionRow name="Correctness" dim={health.dimensions.correctness} />
          <DimensionRow name="Reliability" dim={health.dimensions.reliability} />
        </div>
      </div>
      
      <div className="border-t border-border bg-surface-hover p-4 flex justify-between text-xs text-text-muted">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          {health.recentFailures} failures, {health.degradedRuns} degraded runs
        </div>
      </div>
    </div>
  )
}

function DimensionRow({ name, dim }: { name: string, dim: any }) {
  const color = 
    dim.status === "healthy" ? "text-success" : 
    dim.status === "warning" ? "text-warning" : "text-danger"
    
  const bg = 
    dim.status === "healthy" ? "bg-success/20" : 
    dim.status === "warning" ? "bg-warning/20" : "bg-danger/20"

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-text-secondary">{name}</span>
        <span className={`font-semibold ${color}`}>{dim.score}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-active">
        <div className={`h-full ${bg}`} style={{ width: `${dim.score}%` }} />
      </div>
      <div className="mt-1 text-xs text-text-muted">{dim.summary}</div>
    </div>
  )
}
