import { useParams, useNavigate } from "react-router-dom"
import { useQuery, useMutation } from "@tanstack/react-query"
import { Play, FileCheck, AlertTriangle, CheckCircle2 } from "lucide-react"
import { api } from "@/api/client"
import { queryKeys } from "@/api/query-keys"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

export function WorkflowReview() {
  const { workflowId } = useParams()
  const navigate = useNavigate()

  const { data: workflow, isLoading } = useQuery({
    queryKey: queryKeys.workflows.detail(workflowId!),
    queryFn: () => api.getWorkflow(workflowId!),
    enabled: !!workflowId,
  })

  const activateMutation = useMutation({
    mutationFn: () => api.activateWorkflow(workflowId!),
    onSuccess: () => {
      toast.success("Workflow activated successfully")
      navigate(`/app/workflows/${workflowId}`)
    }
  })

  if (isLoading || !workflow) return null

  return (
    <div className="flex-1 space-y-8 p-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Review & Activate</h1>
        <p className="mt-2 text-muted-foreground">Review the configuration before activating this workflow.</p>
      </div>

      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-surface-raised overflow-hidden">
          <div className="border-b border-border bg-surface px-4 py-3 font-medium">
            Workflow Summary
          </div>
          <div className="p-6 space-y-4">
            <div className="flex justify-between border-b border-border pb-4">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{workflow.name}</span>
            </div>
            <div className="flex justify-between border-b border-border pb-4">
              <span className="text-muted-foreground">Trigger</span>
              <span className="font-medium">Incoming Webhook</span>
            </div>
            <div className="flex justify-between border-b border-border pb-4">
              <span className="text-muted-foreground">Estimated nodes</span>
              <span className="font-medium">5</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-raised overflow-hidden">
          <div className="border-b border-border bg-surface px-4 py-3 font-medium">
            Readiness Checklist
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
              <div>
                <p className="font-medium">Configuration Complete</p>
                <p className="text-sm text-muted-foreground">All required node properties are set.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              <div>
                <p className="font-medium">Mock Connection Used</p>
                <p className="text-sm text-muted-foreground">Slack action node is using mock credentials. Real connection required for production.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-6 border-t border-border">
        <Button variant="outline" onClick={() => navigate(`/app/workflows/${workflowId}/simulation`)}>
          <Play className="mr-2 h-4 w-4" />
          Simulate
        </Button>
        <Button 
          variant="primary" 
          onClick={() => activateMutation.mutate()}
          disabled={activateMutation.isPending}
        >
          <FileCheck className="mr-2 h-4 w-4" />
          Activate Workflow
        </Button>
      </div>
    </div>
  )
}
