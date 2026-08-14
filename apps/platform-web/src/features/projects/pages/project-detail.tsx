import { useParams } from "react-router-dom"
import { useQuery, useMutation } from "@tanstack/react-query"
import { Play, FileCheck, Info } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { StatusBadge } from "@/components/common/status-badge"
import { PlanViewer } from "../components/plan-viewer"
import { RequirePermission } from "@/features/permissions/components/require-permission"
import { ProjectVector } from "@/components/vectors/ProjectVector"

export function ProjectDetail() {
  const { projectId } = useParams()

  const { data: project, isLoading, refetch } = useQuery({
    queryKey: queryKeys.projects.detail(projectId!),
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  })

  const approveMutation = useMutation({
    mutationFn: () => api.approveProjectPlan(projectId!),
    onSuccess: () => {
      toast.success("Project plan approved.")
      refetch()
    }
  })

  if (isLoading || !project) return null

  return (
    <div className="flex-1 space-y-8 p-8 max-w-5xl mx-auto relative">
      <div className="flex items-center justify-between relative">
        <div className="relative z-10">
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          <div className="mt-2 flex items-center gap-3">
            <StatusBadge status={project.status as any} />
          </div>
        </div>
        <div className="flex items-center gap-3 relative z-10">
          {project.status === "draft" && (
            <RequirePermission permission="project.update">
              <Button 
                variant="primary" 
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
              >
                <FileCheck className="mr-2 h-4 w-4" />
                Approve Plan
              </Button>
            </RequirePermission>
          )}
          {(project.status === "ready" || project.status === "planning") && (
            <Button variant="primary" disabled>
              <Play className="mr-2 h-4 w-4" />
              Start Build (Phase 4)
            </Button>
          )}
        </div>
        
        {/* Decorative Vector */}
        <div className="hidden lg:block absolute right-0 top-0 w-[300px] h-16 opacity-80 pointer-events-none">
          <ProjectVector stage={project.status} />
        </div>
      </div>

      {project.brief && (
        <div className="rounded-xl border border-border bg-surface-raised p-6">
          <h2 className="text-lg font-semibold mb-4">Project Brief</h2>
          <div className="space-y-4 text-sm">
            <div>
              <span className="font-medium text-muted-foreground block mb-1">Goal</span>
              <p>{project.brief.goal}</p>
            </div>
            <div>
              <span className="font-medium text-muted-foreground block mb-1">Primary Users</span>
              <p>{project.brief.primaryUsers}</p>
            </div>
            <div>
              <span className="font-medium text-muted-foreground block mb-1">Core Capabilities</span>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {project.brief.coreCapabilities.map((cap, i) => (
                  <li key={i}>{cap}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {project.plan ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Project Plan</h2>
          <PlanViewer plan={project.plan} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-4 opacity-50" />
          <p>No plan generated yet.</p>
        </div>
      )}
    </div>
  )
}
